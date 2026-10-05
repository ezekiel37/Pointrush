import {
  createHash,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import * as s from '../database/schema.js';
import type { FundingDatabase } from '../funding/funding-ledger.js';
import { actorTransaction } from '../tasks/actor-transaction.js';
import { maskPhone, normalizePhone } from './sms.js';
import type { SmsProvider } from './sms.js';

export type PhoneConfig = {
  // Country calling codes SMS may be sent to, e.g. ['+234'].
  allowedPrefixes: string[];
  // Platform-wide cap on codes sent per 24 hours: a cost and abuse ceiling.
  dailyLimit: number;
};
export const defaultPhoneConfig: PhoneConfig = {
  allowedPrefixes: ['+234'],
  dailyLimit: 500,
};

const challengeInput = z
  .object({ phoneNumber: z.string().min(5).max(24) })
  .strict();
const verifyInput = z
  .object({ challengeId: z.uuid(), code: z.string().regex(/^\d{6}$/) })
  .strict();

const hash = (challengeId: string, code: string) =>
  createHash('sha256').update(`${challengeId}:${code}`).digest('hex');

function unavailable(reason: string, message: string) {
  return new ServiceUnavailableException({ statusCode: 503, message, reason });
}

export class PhoneService {
  constructor(
    private readonly db: FundingDatabase,
    private readonly sms?: SmsProvider,
    private readonly config: PhoneConfig = defaultPhoneConfig,
  ) {}

  async status(user: string) {
    return actorTransaction(this.db, user, async (tx, actor) => {
      const [phone] = await tx
        .select()
        .from(s.verifiedPhones)
        .where(eq(s.verifiedPhones.accountId, actor));
      return phone
        ? { verified: true, phone: maskPhone(phone.phoneNumber) }
        : { verified: false, phone: null };
    });
  }

  async requestCode(user: string, input: unknown) {
    const sms = this.sms;
    if (!sms)
      throw unavailable(
        'phone_unavailable',
        'Phone verification is not available yet',
      );
    const parsed = challengeInput.safeParse(input);
    const phone = parsed.success
      ? normalizePhone(
          parsed.data.phoneNumber,
          this.config.allowedPrefixes[0] ?? '+234',
        )
      : null;
    if (!phone) throw new BadRequestException('Enter a valid mobile number');
    if (!this.config.allowedPrefixes.some((p) => phone.startsWith(p)))
      throw new ConflictException({
        statusCode: 409,
        message: 'SMS is not available for this country yet',
        reason: 'country_unsupported',
      });
    const code = randomInt(0, 1000000).toString().padStart(6, '0');
    const id = randomUUID();
    const challenge = await actorTransaction(
      this.db,
      user,
      async (tx, actor) => {
        // Serialise the platform-wide count so the ceiling holds under load.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended('phone-platform', 0))`,
        );
        const [sent] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(s.phoneChallenges)
          .where(
            gt(
              s.phoneChallenges.createdAt,
              sql`clock_timestamp() - interval '24 hours'`,
            ),
          );
        if ((sent?.count ?? 0) >= this.config.dailyLimit)
          throw unavailable(
            'sms_busy',
            'Phone verification is busy; try again later',
          );
        return (
          await tx
            .insert(s.phoneChallenges)
            .values({
              id,
              accountId: actor,
              phoneNumber: phone,
              codeHash: hash(id, code),
            })
            .returning()
        )[0]!;
      },
    );
    // Sent after commit, never inside the transaction. A failed send still
    // counts towards the limits, so failures cannot be used to bypass them.
    try {
      await sms.send({
        to: phone,
        body: `Your Acticlaim code is ${code}. It expires in 10 minutes. Never share it.`,
        reference: challenge.id,
      });
    } catch {
      throw unavailable(
        'sms_failed',
        'We could not send the code; try again in a minute',
      );
    }
    return {
      challengeId: challenge.id,
      phone: maskPhone(phone),
      expiresAt: challenge.expiresAt,
      resendAt: new Date(challenge.createdAt.getTime() + 60000),
    };
  }

  async verify(user: string, input: unknown) {
    const parsed = verifyInput.safeParse(input);
    if (!parsed.success)
      throw new BadRequestException('Enter the 6-digit code');
    const { challengeId, code } = parsed.data;
    // The attempt is committed even when the code is wrong, so guesses count.
    const result = await actorTransaction(this.db, user, async (tx, actor) => {
      const [challenge] = await tx
        .select()
        .from(s.phoneChallenges)
        .where(
          and(
            eq(s.phoneChallenges.id, challengeId),
            eq(s.phoneChallenges.accountId, actor),
          ),
        );
      if (!challenge) throw new NotFoundException();
      const success = timingSafeEqual(
        Buffer.from(hash(challenge.id, code), 'hex'),
        Buffer.from(challenge.codeHash, 'hex'),
      );
      await tx
        .insert(s.phoneChallengeAttempts)
        .values({ challengeId, success });
      if (success)
        await tx
          .insert(s.verifiedPhones)
          .values({ accountId: actor, phoneNumber: challenge.phoneNumber });
      const attempts = await tx
        .select({ id: s.phoneChallengeAttempts.id })
        .from(s.phoneChallengeAttempts)
        .where(eq(s.phoneChallengeAttempts.challengeId, challengeId))
        .orderBy(desc(s.phoneChallengeAttempts.createdAt));
      return {
        success,
        phone: challenge.phoneNumber,
        left: Math.max(0, 5 - attempts.length),
      };
    });
    if (!result.success)
      throw new ConflictException({
        statusCode: 409,
        message: 'That code is not right',
        reason: result.left > 0 ? 'code_wrong' : 'code_expired',
        attemptsLeft: result.left,
      });
    return { verified: true, phone: maskPhone(result.phone) };
  }
}

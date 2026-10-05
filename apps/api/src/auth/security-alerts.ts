import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import * as s from '../database/schema.js';
import type { FundingDatabase } from '../funding/funding-ledger.js';
import { EmailPayloadCipher } from './email-payload.js';
import { authEmailJobs } from './email-queue.schema.js';

// Security emails (a bank account was added, withdrawals were locked). They go
// through the same encrypted queue and worker as sign-in emails. They carry no
// links, so a copy of one cannot be turned into a phishing email.
export interface SecurityAlerts {
  notify(accountId: string, subject: string, text: string): Promise<void>;
}

export class QueuedSecurityAlerts implements SecurityAlerts {
  private readonly cipher: EmailPayloadCipher;
  constructor(
    private readonly db: FundingDatabase,
    key: string,
    private readonly sender: string,
  ) {
    this.cipher = new EmailPayloadCipher(key);
  }

  async notify(accountId: string, subject: string, text: string) {
    const [user] = await this.db
      .select({ email: s.authUsers.email })
      .from(s.authAccountLinks)
      .innerJoin(s.authUsers, eq(s.authUsers.id, s.authAccountLinks.authUserId))
      .where(eq(s.authAccountLinks.accountId, accountId));
    if (!user) return;
    const id = randomUUID();
    const now = new Date();
    await this.db.insert(authEmailJobs).values({
      id,
      state: 'pending',
      attempts: 0,
      createdAt: now,
      availableAt: now,
      expiresAt: new Date(now.getTime() + 24 * 3600000),
      payload: this.cipher.seal(id, {
        from: `Acticlaim <${this.sender}>`,
        to: user.email,
        subject,
        text: `${text}\n\nIf this was not you, open the Acticlaim app, go to Wallet and press "This wasn't me". Acticlaim will never ask for your password or a fee.`,
      }),
    });
  }
}

// Tests and setups without email record alerts in memory.
export class MemorySecurityAlerts implements SecurityAlerts {
  readonly sent: { accountId: string; subject: string; text: string }[] = [];
  notify(accountId: string, subject: string, text: string) {
    this.sent.push({ accountId, subject, text });
    return Promise.resolve();
  }
}

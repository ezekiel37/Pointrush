import { HttpException, HttpStatus } from '@nestjs/common';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as s from '../database/schema.js';

type Db = PgDatabase<PgQueryResultHKT, typeof s>;
export type AuditKind = (typeof s.auditEvents.$inferInsert)['kind'];

export async function recordAudit(
  db: Db,
  event: {
    kind: AuditKind;
    subject: string;
    actor?: string;
    detail?: Record<string, string | number | boolean>;
  },
) {
  await db.insert(s.auditEvents).values({
    kind: event.kind,
    subject: event.subject,
    actor: event.actor ?? null,
    detail: event.detail ?? null,
  });
}

// Withdrawals and bill payments need the password again. Five wrong
// passwords in 15 minutes pause both, so a stolen session cannot guess it.
export async function checkMoneyPassword(
  db: Db,
  authUserId: string,
  action: 'withdrawal' | 'bill',
  verify: () => Promise<boolean>,
) {
  const [recent] = await db
    .select({ failures: sql<number>`count(*)::int` })
    .from(s.auditEvents)
    .where(
      and(
        eq(s.auditEvents.subject, authUserId),
        eq(s.auditEvents.kind, 'money_password_failed'),
        gt(
          s.auditEvents.createdAt,
          sql`clock_timestamp() - interval '15 minutes'`,
        ),
      ),
    );
  if ((recent?.failures ?? 0) >= 5)
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Too many wrong passwords. Try again in 15 minutes.',
        reason: 'password_attempts',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  if (await verify()) return true;
  await recordAudit(db, {
    kind: 'money_password_failed',
    subject: authUserId,
    detail: { action },
  });
  return false;
}

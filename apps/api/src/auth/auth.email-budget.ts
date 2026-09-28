import { createHmac } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type * as schema from '../database/schema.js';
import { authEmailBudgets } from './auth.schema.js';

class BudgetExhausted extends Error {}

export class AuthEmailBudget {
  constructor(
    private readonly db: PgDatabase<PgQueryResultHKT, typeof schema>,
    private readonly secret: string,
    private readonly dailyLimit: number,
  ) {
    if (
      secret.length < 32 ||
      !Number.isInteger(dailyLimit) ||
      dailyLimit < 1 ||
      dailyLimit > 10000
    ) {
      throw new Error('Invalid authentication email budget configuration');
    }
  }

  async claim(recipient: string): Promise<boolean> {
    const recipientKey = createHmac('sha256', this.secret)
      .update('auth-email-recipient:')
      .update(recipient.trim().toLowerCase())
      .digest('hex');
    try {
      await this.db.transaction(async (tx) => {
        // Fixed lock order across instances: global budget, then recipient.
        // If the recipient is limited, rollback also restores the global quota.
        for (const rule of [
          {
            key: 'global',
            seconds: 86400,
            limit: this.dailyLimit,
            cooldown: 0,
          },
          {
            key: `recipient:${recipientKey}`,
            seconds: 3600,
            limit: 3,
            cooldown: 60,
          },
        ]) {
          const expired = sql`${authEmailBudgets.windowStartedAt} + ${rule.seconds} * interval '1 second' <= clock_timestamp()`;
          const claimed = await tx
            .insert(authEmailBudgets)
            .values({ key: rule.key })
            .onConflictDoUpdate({
              target: authEmailBudgets.key,
              set: {
                attempts: sql`case when ${expired} then 1 else ${authEmailBudgets.attempts} + 1 end`,
                windowStartedAt: sql`case when ${expired} then clock_timestamp() else ${authEmailBudgets.windowStartedAt} end`,
                lastAttemptAt: sql`clock_timestamp()`,
              },
              setWhere: sql`(${expired} or ${authEmailBudgets.attempts} < ${rule.limit}) and ${authEmailBudgets.lastAttemptAt} + ${rule.cooldown} * interval '1 second' <= clock_timestamp()`,
            })
            .returning({ key: authEmailBudgets.key });
          if (!claimed.length) throw new BudgetExhausted();
        }
      });
      return true;
    } catch (error) {
      if (error instanceof BudgetExhausted) return false;
      throw error;
    }
  }
}

import { and, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from '../database/schema.js';
import { recordAudit } from '../audit/audit.js';

type SessionDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;
const sessionIdSchema = z.string().trim().min(1).max(200);

export class SessionManagementService {
  constructor(private readonly db: SessionDatabase) {}

  async list(userId: string, currentSessionId: string) {
    const sessions = await this.db
      .select({
        id: schema.authSessions.id,
        createdAt: schema.authSessions.createdAt,
        updatedAt: schema.authSessions.updatedAt,
        expiresAt: schema.authSessions.expiresAt,
        ipAddress: schema.authSessions.ipAddress,
        userAgent: schema.authSessions.userAgent,
      })
      .from(schema.authSessions)
      .where(
        and(
          eq(schema.authSessions.userId, userId),
          sql`${schema.authSessions.expiresAt} > clock_timestamp()`,
        ),
      )
      .orderBy(sql`${schema.authSessions.updatedAt} desc`);
    return sessions.map((session) => ({
      ...session,
      current: session.id === currentSessionId,
    }));
  }

  async revoke(
    userId: string,
    sessionId: string,
  ): Promise<{ revoked: boolean }> {
    const id = sessionIdSchema.parse(sessionId);
    const deleted = await this.db
      .delete(schema.authSessions)
      .where(
        and(
          eq(schema.authSessions.id, id),
          eq(schema.authSessions.userId, userId),
        ),
      )
      .returning({ id: schema.authSessions.id });
    if (deleted.length)
      await recordAudit(this.db, { kind: 'session_revoked', subject: userId });
    return { revoked: deleted.length > 0 };
  }

  async revokeOthers(userId: string, currentSessionId: string) {
    const id = sessionIdSchema.parse(currentSessionId);
    const deleted = await this.db
      .delete(schema.authSessions)
      .where(
        and(
          eq(schema.authSessions.userId, userId),
          ne(schema.authSessions.id, id),
        ),
      )
      .returning({ id: schema.authSessions.id });
    await recordAudit(this.db, {
      kind: 'sessions_revoked',
      subject: userId,
      detail: { count: deleted.length },
    });
    return { revoked: deleted.length };
  }
}

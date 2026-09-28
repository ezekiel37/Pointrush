import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { DatabaseConfig } from './database.config.js';
import { poolOptions } from './database.config.js';
import * as schema from './schema.js';

export const DATABASE_CONFIG = Symbol('DATABASE_CONFIG');

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool?: Pool;
  private readonly database?: NodePgDatabase<typeof schema>;

  constructor(@Inject(DATABASE_CONFIG) config: DatabaseConfig | undefined) {
    if (!config) return;
    this.pool = new Pool(poolOptions(config));
    this.pool.on('error', () => {
      this.logger.error({ event: 'database_idle_connection_error' });
    });
    this.database = drizzle(this.pool, { schema });
  }

  get db(): NodePgDatabase<typeof schema> {
    if (!this.database) throw new Error('Database is not configured');
    return this.database;
  }

  async isReady(): Promise<boolean> {
    if (!this.pool) return false;
    try {
      // Check connectivity and required account/auth tables without reading PII.
      await this.pool.query(
        'SELECT a.id FROM accounts a LEFT JOIN usernames u ON u.account_id = a.id LEFT JOIN verified_phones p ON p.account_id = a.id LEFT JOIN account_profiles profile ON profile.account_id = a.id LEFT JOIN auth_account_links link ON link.account_id = a.id LEFT JOIN auth_users au ON false LEFT JOIN auth_sessions sess ON false LEFT JOIN auth_credentials cred ON false LEFT JOIN auth_verifications v ON false LEFT JOIN auth_rate_limits r ON false LEFT JOIN auth_email_budgets b ON false LEFT JOIN auth_email_jobs j ON false LIMIT 0',
      );
      return true;
    } catch {
      return false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool?.end();
  }
}

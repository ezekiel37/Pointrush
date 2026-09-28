import { fileURLToPath } from 'node:url';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client } from 'pg';
import type { DatabaseConfig } from './database.config.js';
import { poolOptions } from './database.config.js';

export const migrationsFolder = fileURLToPath(
  new URL('../../migrations', import.meta.url),
);
export const migrationLock = 714027001;

export async function runMigrations(
  config: DatabaseConfig,
  folder = migrationsFolder,
): Promise<void> {
  const client = new Client({
    ...poolOptions(config),
    application_name: 'pointrush-migrations',
    statement_timeout: 30000,
    query_timeout: 35000,
    lock_timeout: 5000,
  });
  try {
    await client.connect();
    const lock = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS locked',
      [migrationLock],
    );
    if (!lock.rows[0]?.locked) throw new Error('Another migration is running');
    const files = readMigrationFiles({ migrationsFolder: folder });
    const exists = await client.query<{ relation: string | null }>(
      "SELECT to_regclass('drizzle.__drizzle_migrations') AS relation",
    );
    if (exists.rows[0]?.relation) {
      const applied = await client.query<{ hash: string; created_at: string }>(
        'SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at',
      );
      for (const [index, row] of applied.rows.entries()) {
        const file = files[index];
        if (
          !file ||
          file.hash !== row.hash ||
          String(file.folderMillis) !== row.created_at
        ) {
          throw new Error('Migration history differs from this release');
        }
      }
    }
    await migrate(drizzle(client), { migrationsFolder: folder });
  } finally {
    // A direct connection owns the session lock; closing releases it even on failure.
    await client.end();
  }
}

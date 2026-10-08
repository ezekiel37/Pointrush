import { readDatabaseConfig } from './database.config.js';
import { runMigrations } from './migrate.js';
import { safeErrorSummary } from './safe-error.js';

try {
  const config = readDatabaseConfig(process.env, 'MIGRATION_DATABASE_URL');
  if (!config) throw new Error('Migration connection required');
  await runMigrations(config);
  process.stdout.write('Database migrations completed.\n');
} catch (error) {
  process.stderr.write(
    `Database migration failed. Check connectivity, migration history, permissions and concurrent migration jobs. Cause: ${safeErrorSummary(error)}\n`,
  );
  process.exitCode = 1;
}

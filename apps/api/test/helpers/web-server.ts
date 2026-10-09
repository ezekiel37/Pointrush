// Browser-test fixture only. Never imported by src/ or included in production dist.
import 'reflect-metadata';
import { lowLimits } from './settings.js';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { Request, Response } from 'express';
import { AppModule } from '../../src/app.module.js';
import { AuthService } from '../../src/auth/auth.service.js';
import { createAuth } from '../../src/auth/auth.factory.js';
import type { AuthEmail } from '../../src/auth/auth.email.js';
import { DatabaseService } from '../../src/database/database.service.js';
import * as schema from '../../src/database/schema.js';
import { configureHttp } from '../../src/http/configure-http.js';

if (process.env.POINTRUSH_BROWSER_TEST !== '1')
  throw new Error('Test fixture requires explicit opt-in');
const pg = new PGlite();
const db = drizzle(pg, { schema });
await migrate(db, { migrationsFolder: resolve('migrations') });
await lowLimits(db);
const origin = 'http://localhost:3100';
const config = {
  secret: randomBytes(32).toString('hex'),
  baseURL: 'http://localhost:8081',
  trustedOrigins: [origin],
  emailFrom: 'test@example.test',
  emailEncryptionKey: randomBytes(32).toString('hex'),
};
const mailbox: AuthEmail[] = [];
const auth = createAuth(db, config, async (message) => {
  mailbox.push(message);
});
const service = new AuthService(auth, config.baseURL, config.trustedOrigins);
const module = await Test.createTestingModule({
  imports: [AppModule.forRoot(undefined, config)],
})
  .overrideProvider(DatabaseService)
  .useValue({ db, isReady: async () => true })
  .overrideProvider(AuthService)
  .useValue(service)
  .compile();
const app = module.createNestApplication<NestExpressApplication>({
  logger: false,
  bodyParser: false,
});
// Loopback-only fixture reads fake test mail; this is not a product endpoint.
app.use('/__test/mail', (req: Request, res: Response) => {
  res.json(mailbox.filter((item) => item.to === req.query.email));
});
configureHttp(
  app,
  { nodeEnv: 'test', port: 8081, corsOrigins: [origin] },
  service.handler,
);
await app.listen(8081, '127.0.0.1');
const shutdown = async () => {
  await app.close();
  await pg.close();
  process.exit(0);
};
process.once('SIGTERM', () => {
  void shutdown();
});
process.once('SIGINT', () => {
  void shutdown();
});

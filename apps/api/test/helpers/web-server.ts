// Browser-test fixture only. Never imported by src/ or included in production dist.
import 'reflect-metadata';
import { lowLimits } from './settings.js';
import { randomBytes, randomUUID } from 'node:crypto';
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
import { SponsorsService } from '../../src/sponsors/sponsors.service.js';
import { ProfileEditsService } from '../../src/profiles/profile-edits.service.js';

if (process.env.POINTRUSH_BROWSER_TEST !== '1')
  throw new Error('Test fixture requires explicit opt-in');
const pg = new PGlite();
const db = drizzle(pg, { schema });
await migrate(db, { migrationsFolder: resolve('migrations') });
await lowLimits(db);
// Public business pages are looked up by the web server itself, which
// browser mocks cannot reach: one real business, renamed once, so the
// old handle redirects and unknown handles are a true 404.
{
  const user = randomUUID();
  const [account] = await db.insert(schema.accounts).values({}).returning();
  await db.insert(schema.authUsers).values({
    id: user,
    name: 'Seed owner',
    email: 'seed-owner@example.test',
    emailVerified: true,
  });
  await db
    .insert(schema.authAccountLinks)
    .values({ accountId: account!.id, authUserId: user });
  await new SponsorsService({ db }, 'seed').createProfile(user, {
    name: 'Mama Put Kitchen',
    handle: 'mama_put',
    acceptTerms: true,
    termsVersion: 'seed',
  });
  await new ProfileEditsService(db).changeHandle(user, {
    handle: 'mama_put_ikeja',
  });
}
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
// The web server looks business pages up itself, where browser mocks cannot
// reach. This fixture runs no business modules, so it answers that one read
// with the real service (the seeded business above).
const edits = new ProfileEditsService(db);
app.use(/^\/api\/v1\/businesses\/[^/]+$/, (req: Request, res: Response) => {
  if (req.method !== 'GET') return res.status(404).json({ statusCode: 404 });
  const handle = decodeURIComponent(
    req.originalUrl.split('?')[0]!.split('/').pop() ?? '',
  );
  edits.publicBusiness(handle).then(
    (page) => res.json(page),
    () => res.status(404).json({ statusCode: 404 }),
  );
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

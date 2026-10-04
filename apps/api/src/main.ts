import 'reflect-metadata';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { readEnvironment } from './config/environment.js';
import { configureHttp } from './http/configure-http.js';
import { AuthService } from './auth/auth.service.js';

async function bootstrap(): Promise<void> {
  const config = readEnvironment(process.env);
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.forRoot(config.database, config.auth, config.sponsorTermsVersion),
    {
      logger: new ConsoleLogger({ json: true }),
      rawBody: true,
      bodyParser: false,
    },
  );
  const authHandler = config.auth ? app.get(AuthService).handler : undefined;
  configureHttp(app, config, authHandler);
  app.enableShutdownHooks();
  await app.listen(config.port, '0.0.0.0');
}

void bootstrap().catch(() => {
  process.stderr.write(
    'Acticlaim API startup failed. Check configuration and service logs.\n',
  );
  process.exitCode = 1;
});

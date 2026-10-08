import 'reflect-metadata';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { readEnvironment } from './config/environment.js';
import { configureHttp } from './http/configure-http.js';
import { AuthService } from './auth/auth.service.js';
import { paymentProvider } from './payments/payments.module.js';
import { smsProvider } from './phone/phone.module.js';
import { safeErrorSummary } from './database/safe-error.js';

async function bootstrap(): Promise<void> {
  const config = readEnvironment(process.env);
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.forRoot(
      config.database,
      config.auth,
      config.sponsorTermsVersion,
      paymentProvider(config.payments),
      {
        provider: smsProvider(config.sms),
        ...(config.sms ? { config: config.sms } : {}),
      },
      { jobs: config.jobsEnabled ?? true },
    ),
    {
      logger: new ConsoleLogger({ json: true }),
      rawBody: true,
      bodyParser: false,
    },
  );
  const authHandler = config.auth ? app.get(AuthService).handler : undefined;
  configureHttp(app, config, authHandler);
  if (
    config.nodeEnv === 'production' &&
    config.payments?.provider === 'bachs' &&
    config.payments.apiKey.startsWith('sk_sandbox_')
  )
    process.stdout.write(
      JSON.stringify({
        level: 'warn',
        event: 'payments_sandbox',
        message: 'Payments use the Bachs sandbox: no real money moves.',
      }) + '\n',
    );
  app.enableShutdownHooks();
  await app.listen(config.port, '0.0.0.0');
}

void bootstrap().catch((error: unknown) => {
  process.stderr.write(
    `Acticlaim API startup failed. Check configuration and service logs. Cause: ${safeErrorSummary(error)}\n`,
  );
  process.exitCode = 1;
});

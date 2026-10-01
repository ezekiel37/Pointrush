import 'reflect-metadata';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { z } from 'zod';
import { parseEnvironment } from '../config/validation.js';
import { readEmailWorkerEnvironment } from '../config/email-worker.environment.js';
import { configureHttp } from '../http/configure-http.js';
import { EmailHttpModule } from './email-http.js';

async function bootstrap() {
  const http = parseEnvironment(
    z.object({
      EMAIL_WORKER_TRIGGER_SECRET: z.string().regex(/^[0-9a-f]{64}$/i),
      PORT: z
        .string()
        .regex(/^\d+$/)
        .default('8080')
        .transform(Number)
        .pipe(z.number().int().min(1).max(65535)),
    }),
    process.env,
  );
  const config = readEmailWorkerEnvironment(process.env);
  const app = await NestFactory.create<NestExpressApplication>(
    EmailHttpModule.forRoot(config, http.EMAIL_WORKER_TRIGGER_SECRET),
    { logger: new ConsoleLogger({ json: true }), bodyParser: false },
  );
  configureHttp(app, {
    nodeEnv: 'production',
    port: http.PORT,
    corsOrigins: [],
  });
  app.enableShutdownHooks();
  await app.listen(http.PORT, '0.0.0.0');
}

void bootstrap().catch(() => {
  process.stderr.write(
    'PointRush email HTTP worker startup failed. Check configuration.\n',
  );
  process.exitCode = 1;
});

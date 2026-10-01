import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  PayloadTooLargeException,
  ValidationPipe,
} from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import type { IncomingMessage, ServerResponse } from 'node:http';
import helmet from 'helmet';
import type { Environment } from '../config/environment.js';
import { ApiExceptionFilter } from './exception.filter.js';

export function configureHttp(
  app: NestExpressApplication,
  config: Environment,
  authHandler?: (
    request: IncomingMessage,
    response: ServerResponse,
  ) => Promise<void>,
): void {
  app.disable('x-powered-by');
  // Do not infer trust from a header or a guessed number of cloud proxy hops.
  // See INGRESS.md before changing this deployment boundary.
  app.set('trust proxy', false);
  app.use(helmet());
  app.use((_request: Request, response: Response, next: NextFunction) => {
    const requestId = randomUUID();
    response.locals.requestId = requestId;
    response.setHeader('X-Request-Id', requestId);
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.enableCors({
    origin: config.corsOrigins,
    credentials: Boolean(authHandler),
    exposedHeaders: ['X-Request-Id'],
  });
  if (authHandler) {
    // This must remain before Nest's ordinary body parsers. Better Auth reads
    // and bounds the request stream itself.
    app.use('/api/v1/auth', authHandler);
  }
  app.useBodyParser('json', { limit: '64kb' });
  app.useBodyParser('urlencoded', { limit: '64kb', extended: false });
  app.use(
    (
      error: unknown,
      _request: Request,
      _response: Response,
      next: NextFunction,
    ) => {
      // Parser errors are not Nest exceptions and may include fragments of the body.
      if (error instanceof Error && 'type' in error) {
        if (error.type === 'entity.too.large') {
          next(
            new PayloadTooLargeException(
              'Request body exceeds the allowed size',
            ),
          );
          return;
        }
        if (error.type === 'entity.parse.failed') {
          next(new BadRequestException('Malformed request body'));
          return;
        }
      }
      next(error);
    },
  );
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      validationError: { target: false, value: false },
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
}

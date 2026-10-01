import { createHash, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  Controller,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  Module,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { DynamicModule, OnApplicationShutdown } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DatabaseModule } from '../database/database.module.js';
import { DatabaseService } from '../database/database.service.js';
import type { readEmailWorkerEnvironment } from '../config/email-worker.environment.js';
import { createResendPayloadSender } from './auth.email.js';
import { EmailWorker } from './email-worker.js';

export const EMAIL_RUNNER_CONFIG = Symbol('EMAIL_RUNNER_CONFIG');
export interface EmailRunnerConfig {
  secret: string;
  maxDurationMs: number;
}
const digest = (value: string) => createHash('sha256').update(value).digest();

@Injectable()
export class EmailBatchRunner implements OnApplicationShutdown {
  private active?: AbortController;
  private closing = false;
  constructor(
    @Inject(EmailWorker)
    private readonly worker: Pick<EmailWorker, 'runOne' | 'prune'>,
    @Inject(EMAIL_RUNNER_CONFIG) private readonly config: EmailRunnerConfig,
  ) {}

  authorize(value: string | undefined) {
    if (!value || !timingSafeEqual(digest(value), digest(this.config.secret)))
      throw new UnauthorizedException();
  }

  async run(disconnected: AbortSignal) {
    if (this.active || this.closing)
      throw new ServiceUnavailableException('Worker is busy');
    const controller = new AbortController();
    this.active = controller;
    const signal = AbortSignal.any([controller.signal, disconnected]);
    const timer = setTimeout(
      () => controller.abort(),
      this.config.maxDurationMs,
    );
    const outcomes: Record<string, number> = {};
    try {
      for (let count = 0; count < 25 && !signal.aborted; count++) {
        const outcome = await this.worker.runOne(signal);
        outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
        if (outcome === 'idle') break;
      }
      if (!signal.aborted) await this.worker.prune();
      return { outcomes, interrupted: signal.aborted };
    } finally {
      clearTimeout(timer);
      this.active = undefined;
    }
  }

  onApplicationShutdown() {
    this.closing = true;
    this.active?.abort();
  }
}

@Controller('internal/auth-email')
export class EmailRunnerController {
  private readonly logger = new Logger(EmailRunnerController.name);
  constructor(private readonly runner: EmailBatchRunner) {}

  @Post('run')
  @HttpCode(200)
  async run(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.runner.authorize(request.get('X-PointRush-Worker-Key'));
    // A trigger cannot choose recipients, job IDs, payloads or batch size.
    if (
      Object.keys(request.query).length ||
      request.headers['transfer-encoding'] ||
      (request.headers['content-length'] &&
        request.headers['content-length'] !== '0')
    )
      throw new BadRequestException('Trigger must have no body or query');
    const disconnected = new AbortController();
    const onClose = () => {
      if (!response.writableEnded) disconnected.abort();
    };
    response.on('close', onClose);
    response.setHeader('Retry-After', '60');
    try {
      const result = await this.runner.run(disconnected.signal);
      this.logger.log({
        event: 'auth_email_batch',
        requestId: response.locals.requestId,
        ...result,
      });
      return result;
    } finally {
      response.off('close', onClose);
    }
  }
}

@Module({})
export class EmailHttpModule {
  static forRoot(
    config: ReturnType<typeof readEmailWorkerEnvironment>,
    secret: string,
  ): DynamicModule {
    return {
      module: EmailHttpModule,
      imports: [DatabaseModule.forRoot(config.database)],
      controllers: [EmailRunnerController],
      providers: [
        {
          provide: EMAIL_RUNNER_CONFIG,
          useValue: { secret, maxDurationMs: config.maxDurationMs },
        },
        {
          provide: EmailWorker,
          inject: [DatabaseService],
          useFactory: (database: DatabaseService) =>
            new EmailWorker(
              database.db!,
              config.emailEncryptionKey,
              createResendPayloadSender(config.resendApiKey),
            ),
        },
        EmailBatchRunner,
      ],
    };
  }
}

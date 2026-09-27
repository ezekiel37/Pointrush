import { Catch, HttpException, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    const requestId: unknown = response.locals.requestId;
    if (status >= 500) {
      // Do not log raw exceptions: provider errors can contain credentials or payloads.
      this.logger.error({ event: 'request_failed', requestId, status });
    }
    const details =
      exception instanceof HttpException ? exception.getResponse() : null;
    const message =
      status >= 500
        ? 'Internal server error'
        : status === 404
          ? 'Not found'
          : typeof details === 'string'
            ? details
            : details && 'message' in details
              ? details.message
              : 'Request failed';
    response.status(status).json({ statusCode: status, message, requestId });
  }
}

import { Catch, HttpException, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { AccountError } from '../accounts/account.error.js';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : exception instanceof AccountError
          ? exception.code === 'USERNAME_UNAVAILABLE' ||
            exception.code === 'ACCOUNT_ALREADY_EXISTS'
            ? 409
            : exception.code === 'AUTH_IDENTITY_UNVERIFIED' ||
                exception.code === 'ACCOUNT_NOT_ACTIVE'
              ? 403
              : exception.code === 'ACCOUNT_NOT_FOUND'
                ? 404
                : 400
          : 500;
    const requestId: unknown = response.locals.requestId;
    if (status >= 500) {
      // Do not log raw exceptions: provider errors can contain credentials or payloads.
      this.logger.error({ event: 'request_failed', requestId, status });
    }
    const details =
      exception instanceof HttpException
        ? exception.getResponse()
        : exception instanceof AccountError
          ? exception.message
          : null;
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

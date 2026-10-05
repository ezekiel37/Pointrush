import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  Optional,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { AUTH_USER_ID, PublicRoute } from '../auth/session.guard.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { AuthService } from '../auth/auth.service.js';
import { RateLimit } from '../http/rate-limit.js';
import { InvalidWebhook } from './provider.js';
import { PaymentsService } from './payments.service.js';

@Controller()
export class PaymentsController {
  constructor(
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Optional() @Inject(AuthService) private readonly auth?: AuthService,
  ) {}
  @Post('payments/funding-intents')
  fund(@Req() r: AuthenticatedRequest, @Body() body: unknown) {
    return this.payments.createFundingIntent(r[AUTH_USER_ID], body);
  }
  // Called by the provider, not a browser: authenticated by its signature.
  @PublicRoute()
  @Post('payments/webhooks/:provider')
  @HttpCode(200)
  async webhook(
    @Req() r: RawBodyRequest<Request>,
    @Param('provider') provider: string,
  ) {
    try {
      const result = await this.payments.handleWebhook(
        provider,
        r.rawBody,
        r.headers,
      );
      return { received: true, outcome: result.outcome };
    } catch (error) {
      if (error instanceof InvalidWebhook)
        throw new BadRequestException('Webhook could not be verified');
      throw error;
    }
  }
  @Get('wallet/banks')
  banks() {
    return this.payments.banks();
  }
  @Get('wallet/bank-account')
  destination(@Req() r: AuthenticatedRequest) {
    return this.payments.destination(r[AUTH_USER_ID]);
  }
  @Post('wallet/bank-account')
  addDestination(@Req() r: AuthenticatedRequest, @Body() body: unknown) {
    return this.payments.addDestination(r[AUTH_USER_ID], body);
  }
  // Withdrawing needs the password again, and few attempts a minute, so a
  // stolen session or guessed password cannot drain a wallet.
  @Post('wallet/withdrawals')
  @RateLimit({ limit: 10, windowMs: 60000 })
  async withdraw(@Req() r: AuthenticatedRequest, @Body() body: unknown) {
    const { password, ...request } =
      body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    if (
      !this.auth ||
      typeof password !== 'string' ||
      !(await this.auth.verifyPassword(r.headers, password))
    )
      throw new ConflictException({
        statusCode: 409,
        message: 'Enter your password to withdraw',
        reason: 'password_required',
      });
    return this.payments.requestWithdrawal(r[AUTH_USER_ID], request);
  }
  @Post('wallet/lock')
  lock(@Req() r: AuthenticatedRequest) {
    return this.payments.lockWithdrawals(r[AUTH_USER_ID]);
  }
  @Get('wallet/withdrawals')
  withdrawals(@Req() r: AuthenticatedRequest, @Query() query: unknown) {
    return this.payments.withdrawalList(r[AUTH_USER_ID], query);
  }
}

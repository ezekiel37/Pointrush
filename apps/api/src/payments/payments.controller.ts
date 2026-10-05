import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { AUTH_USER_ID, PublicRoute } from '../auth/session.guard.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { InvalidWebhook } from './provider.js';
import { PaymentsService } from './payments.service.js';

@Controller()
export class PaymentsController {
  constructor(
    @Inject(PaymentsService) private readonly payments: PaymentsService,
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
  @Post('wallet/withdrawals')
  withdraw(@Req() r: AuthenticatedRequest, @Body() body: unknown) {
    return this.payments.requestWithdrawal(r[AUTH_USER_ID], body);
  }
  @Get('wallet/withdrawals')
  withdrawals(@Req() r: AuthenticatedRequest, @Query() query: unknown) {
    return this.payments.withdrawalList(r[AUTH_USER_ID], query);
  }
}

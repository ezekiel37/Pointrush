import {
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Optional,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { AUTH_USER_ID } from '../auth/session.guard.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { AuthService } from '../auth/auth.service.js';
import { RateLimit } from '../http/rate-limit.js';
import { BillsService } from './bills.service.js';

@Controller()
export class BillsController {
  constructor(
    @Inject(BillsService) private readonly bills: BillsService,
    @Optional() @Inject(AuthService) private readonly auth?: AuthService,
  ) {}
  @Get('wallet/bills/options')
  options() {
    return this.bills.options();
  }
  @Post('wallet/bills/verify')
  @RateLimit({ limit: 20, windowMs: 60000 })
  verify(@Req() r: AuthenticatedRequest, @Body() body: unknown) {
    return this.bills.verify(r[AUTH_USER_ID], body);
  }
  // Like a withdrawal, spending the wallet needs the password again, so a
  // stolen session cannot turn a balance into airtime.
  @Post('wallet/bills')
  @RateLimit({ limit: 10, windowMs: 60000 })
  async buy(@Req() r: AuthenticatedRequest, @Body() body: unknown) {
    const { password, ...request } =
      body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    if (
      !this.auth ||
      typeof password !== 'string' ||
      !(await this.auth.verifyPassword(r.headers, password))
    )
      throw new ConflictException({
        statusCode: 409,
        message: 'Enter your password to pay',
        reason: 'password_required',
      });
    return this.bills.buy(r[AUTH_USER_ID], request);
  }
  @Get('wallet/bills')
  list(@Req() r: AuthenticatedRequest, @Query() query: unknown) {
    return this.bills.list(r[AUTH_USER_ID], query);
  }
}

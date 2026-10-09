import { Controller, Get, Inject, Req } from '@nestjs/common';
import { AUTH_USER_ID } from '../auth/session.guard.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { ReferralsService } from './referrals.service.js';

@Controller('referrals')
export class ReferralsController {
  constructor(
    @Inject(ReferralsService) private readonly referrals: ReferralsService,
  ) {}
  @Get('me')
  mine(@Req() r: AuthenticatedRequest) {
    return this.referrals.mine(r[AUTH_USER_ID]);
  }
}

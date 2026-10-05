import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { AdminMfaRequired, AUTH_USER_ID } from '../auth/session.guard.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { AdminService } from './admin.service.js';

@Controller('admin')
@AdminMfaRequired()
export class AdminController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}
  @Get('accounts')
  find(@Req() r: AuthenticatedRequest, @Query('username') username: unknown) {
    return this.admin.findAccount(r[AUTH_USER_ID], username);
  }
  @Post('accounts/:id/access')
  access(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.admin.setAccess(r[AUTH_USER_ID], id, body);
  }
  @Post('accounts/:id/withdrawal-unlocks')
  unlock(@Req() r: AuthenticatedRequest, @Param('id') id: string) {
    return this.admin.unlockWithdrawals(r[AUTH_USER_ID], id);
  }
  @Get('payments/flagged')
  flagged(@Req() r: AuthenticatedRequest) {
    return this.admin.flaggedPayments(r[AUTH_USER_ID]);
  }
  @Post('payments/events/:id/reviews')
  review(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.admin.reviewPayment(r[AUTH_USER_ID], id, body);
  }
}

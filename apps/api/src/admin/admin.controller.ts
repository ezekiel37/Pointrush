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
  @Get('search')
  search(@Req() r: AuthenticatedRequest, @Query('q') q: unknown) {
    return this.admin.search(r[AUTH_USER_ID], q);
  }
  @Get('accounts/:id')
  detail(@Req() r: AuthenticatedRequest, @Param('id') id: string) {
    return this.admin.accountDetail(r[AUTH_USER_ID], id);
  }
  @Get('analytics')
  analytics(@Req() r: AuthenticatedRequest) {
    return this.admin.analytics(r[AUTH_USER_ID]);
  }
  @Get('profile-changes')
  profileChanges(@Req() r: AuthenticatedRequest) {
    return this.admin.profileChanges(r[AUTH_USER_ID]);
  }
  @Post('profile-changes/:id/decisions')
  decideProfileChange(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.admin.decideProfileChange(r[AUTH_USER_ID], id, body);
  }
  @Post('businesses/:id/handle')
  setBusinessHandle(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.admin.setBusinessHandle(r[AUTH_USER_ID], id, body);
  }
  @Get('referrals')
  referralPool(@Req() r: AuthenticatedRequest) {
    return this.admin.referralPool(r[AUTH_USER_ID]);
  }
  @Post('referrals/topups')
  fundReferralPool(@Req() r: AuthenticatedRequest, @Body() body: unknown) {
    return this.admin.fundReferralPool(r[AUTH_USER_ID], body);
  }
  @Get('settings')
  settings(@Req() r: AuthenticatedRequest) {
    return this.admin.settings(r[AUTH_USER_ID]);
  }
  @Post('settings')
  updateSettings(@Req() r: AuthenticatedRequest, @Body() body: unknown) {
    return this.admin.updateSettings(r[AUTH_USER_ID], body);
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
  @Get('disputes')
  disputes(@Req() r: AuthenticatedRequest) {
    return this.admin.voidDisputes(r[AUTH_USER_ID]);
  }
  @Post('disputes/:id/rulings')
  rule(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.admin.ruleOnVoid(r[AUTH_USER_ID], id, body);
  }
}

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
import { AUTH_USER_ID } from '../auth/session.guard.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { CampaignsService } from './campaigns.service.js';
import { BusinessOverviewService } from './business-overview.service.js';

@Controller()
export class CampaignsController {
  constructor(
    @Inject(CampaignsService) private readonly campaigns: CampaignsService,
    @Inject(BusinessOverviewService)
    private readonly overviews: BusinessOverviewService,
  ) {}
  @Get('business/overview')
  overview(@Req() r: AuthenticatedRequest, @Query() query: unknown) {
    return this.overviews.overview(r[AUTH_USER_ID], query);
  }
  @Post('campaigns/:id/codes')
  activate(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.campaigns.activate(r[AUTH_USER_ID], id, body);
  }
  @Post('campaigns/:id/confirmations')
  confirm(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.campaigns.confirm(r[AUTH_USER_ID], id, body);
  }
  @Get('campaigns/:id/summary')
  summary(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    return this.campaigns.summary(r[AUTH_USER_ID], id, query);
  }
  @Post('campaigns/:id/returns')
  returnFunds(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.campaigns.returnFunds(r[AUTH_USER_ID], id, body);
  }
  @Get('purchases')
  purchases(@Req() r: AuthenticatedRequest, @Query() query: unknown) {
    return this.campaigns.purchases(r[AUTH_USER_ID], query);
  }
  @Post('purchases/:id/voids')
  voidPurchase(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.campaigns.voidPurchase(r[AUTH_USER_ID], id, body);
  }
  @Post('purchases/:id/disputes')
  dispute(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.campaigns.dispute(r[AUTH_USER_ID], id, body);
  }
  @Post('purchases/:id/releases')
  release(@Req() r: AuthenticatedRequest, @Param('id') id: string) {
    return this.campaigns.release(r[AUTH_USER_ID], id);
  }
}

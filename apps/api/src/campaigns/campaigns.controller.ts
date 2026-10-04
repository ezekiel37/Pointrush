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

@Controller()
export class CampaignsController {
  constructor(
    @Inject(CampaignsService) private readonly campaigns: CampaignsService,
  ) {}
  @Post('campaigns/:id/codes')
  activate(@Req() r: AuthenticatedRequest, @Param('id') id: string) {
    return this.campaigns.activate(r[AUTH_USER_ID], id);
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
  @Post('purchases/:id/releases')
  release(@Req() r: AuthenticatedRequest, @Param('id') id: string) {
    return this.campaigns.release(r[AUTH_USER_ID], id);
  }
}

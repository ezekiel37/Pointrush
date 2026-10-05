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
import { PromotionsService } from './promotions.service.js';

@Controller()
export class PromotionsController {
  constructor(
    @Inject(PromotionsService) private readonly promotions: PromotionsService,
  ) {}
  @Post('promotions/:id/batches')
  createBatch(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.promotions.createBatch(r[AUTH_USER_ID], id, body);
  }
  @Get('promotions/:id/summary')
  summary(@Req() r: AuthenticatedRequest, @Param('id') id: string) {
    return this.promotions.summary(r[AUTH_USER_ID], id);
  }
  @Post('code-batches/:id/activations')
  activate(@Req() r: AuthenticatedRequest, @Param('id') id: string) {
    return this.promotions.activateBatch(r[AUTH_USER_ID], id);
  }
  @Post('code-batches/:id/revocations')
  revoke(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.promotions.revokeBatch(r[AUTH_USER_ID], id, body);
  }
  @Post('promotions/:id/handovers')
  handOver(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.promotions.handOver(r[AUTH_USER_ID], id, body);
  }
  @Post('claims/:id/cash-outs')
  cashOut(@Req() r: AuthenticatedRequest, @Param('id') id: string) {
    return this.promotions.cashOut(r[AUTH_USER_ID], id);
  }
  @Post('claims')
  claim(@Req() r: AuthenticatedRequest, @Body() body: unknown) {
    return this.promotions.claim(r[AUTH_USER_ID], body);
  }
  @Get('claims')
  claims(@Req() r: AuthenticatedRequest, @Query() query: unknown) {
    return this.promotions.claims(r[AUTH_USER_ID], query);
  }
}

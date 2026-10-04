import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { AUTH_USER_ID } from '../auth/session.guard.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { PointsService } from './points.service.js';

@Controller('points')
export class PointsController {
  constructor(@Inject(PointsService) private readonly points: PointsService) {}
  @Get()
  summary(@Req() r: AuthenticatedRequest) {
    return this.points.summary(r[AUTH_USER_ID]);
  }
  @Get('entries')
  entries(@Req() r: AuthenticatedRequest, @Query() query: unknown) {
    return this.points.entries(r[AUTH_USER_ID], query);
  }
  @Post('referral')
  refer(@Req() r: AuthenticatedRequest, @Body() body: unknown) {
    return this.points.refer(r[AUTH_USER_ID], body);
  }
}

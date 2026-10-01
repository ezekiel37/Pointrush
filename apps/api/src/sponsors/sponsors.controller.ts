import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { AUTH_USER_ID } from '../auth/session.guard.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { SponsorsService } from './sponsors.service.js';

@Controller('sponsor')
export class SponsorsController {
  constructor(
    @Inject(SponsorsService) private readonly sponsors: SponsorsService,
  ) {}
  @Get('profile')
  getProfile(@Req() request: AuthenticatedRequest) {
    return this.sponsors.getProfile(request[AUTH_USER_ID]);
  }
  @Post('profile')
  createProfile(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.sponsors.createProfile(request[AUTH_USER_ID], body);
  }
  @Post('tasks')
  createTask(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.sponsors.createTask(request[AUTH_USER_ID], body);
  }
  @Get('tasks/:id')
  getTask(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.sponsors.getTask(request[AUTH_USER_ID], id);
  }
}

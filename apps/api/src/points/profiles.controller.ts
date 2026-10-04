import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { AUTH_USER_ID, PublicRoute } from '../auth/session.guard.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { ProfilesService } from './profiles.service.js';

@Controller('profiles')
export class ProfilesController {
  constructor(
    @Inject(ProfilesService) private readonly profiles: ProfilesService,
  ) {}
  @Get('me')
  own(@Req() r: AuthenticatedRequest) {
    return this.profiles.own(r[AUTH_USER_ID]);
  }
  @Post('me/visibility')
  visibility(@Req() r: AuthenticatedRequest, @Body() body: unknown) {
    return this.profiles.setVisibility(r[AUTH_USER_ID], body);
  }
  // Shareable without signing in; returns only opted-in, active profiles.
  @PublicRoute()
  @Get(':username')
  read(@Param('username') username: string) {
    return this.profiles.publicProfile(username);
  }
}

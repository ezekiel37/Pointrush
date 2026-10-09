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
import { AUTH_USER_ID, PublicRoute } from '../auth/session.guard.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { RateLimit } from '../http/rate-limit.js';
import { ProfileEditsService } from './profile-edits.service.js';

@Controller()
export class ProfileEditsController {
  constructor(
    @Inject(ProfileEditsService) private readonly edits: ProfileEditsService,
  ) {}
  @Get('handles/check')
  @RateLimit({ limit: 60, windowMs: 60000 })
  check(@Req() r: AuthenticatedRequest, @Query('handle') handle: unknown) {
    return this.edits.checkHandle(r[AUTH_USER_ID], handle);
  }
  @Get('sponsor/profile/details')
  mine(@Req() r: AuthenticatedRequest) {
    return this.edits.mine(r[AUTH_USER_ID]);
  }
  @Post('sponsor/profile/handle')
  handle(@Req() r: AuthenticatedRequest, @Body() body: unknown) {
    return this.edits.changeHandle(r[AUTH_USER_ID], body);
  }
  @Post('sponsor/profile/changes')
  change(@Req() r: AuthenticatedRequest, @Body() body: unknown) {
    return this.edits.change(r[AUTH_USER_ID], body);
  }
  @Post('accounts/me/display-name')
  displayName(@Req() r: AuthenticatedRequest, @Body() body: unknown) {
    return this.edits.changeDisplayName(r[AUTH_USER_ID], body);
  }
  @Post('accounts/me/username')
  username(@Req() r: AuthenticatedRequest, @Body() body: unknown) {
    return this.edits.changeUsername(r[AUTH_USER_ID], body);
  }
  // Shareable business page, readable without signing in.
  @PublicRoute()
  @Get('businesses/:handle')
  business(@Param('handle') handle: string) {
    return this.edits.publicBusiness(handle);
  }
}

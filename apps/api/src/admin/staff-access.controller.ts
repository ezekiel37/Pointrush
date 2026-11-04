import { Controller, Get, Inject, Req } from '@nestjs/common';
import { AUTH_SESSION_ID, AUTH_USER_ID } from '../auth/session.guard.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { AdminService } from './admin.service.js';

// Whether to show the staff area at all. Signed in, but no authenticator
// check needed: it is how the page knows to ask for one.
@Controller('staff')
export class StaffAccessController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}
  @Get('access')
  access(@Req() r: AuthenticatedRequest) {
    return this.admin.access(r[AUTH_USER_ID], r[AUTH_SESSION_ID]);
  }
}

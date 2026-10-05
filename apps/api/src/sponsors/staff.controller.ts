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
import { StaffService } from './staff.service.js';

@Controller()
export class StaffController {
  constructor(@Inject(StaffService) private readonly staff: StaffService) {}
  @Get('business/staff')
  list(@Req() r: AuthenticatedRequest) {
    return this.staff.list(r[AUTH_USER_ID]);
  }
  @Post('business/staff')
  add(@Req() r: AuthenticatedRequest, @Body() body: unknown) {
    return this.staff.add(r[AUTH_USER_ID], body);
  }
  @Post('business/staff/:id/removals')
  remove(@Req() r: AuthenticatedRequest, @Param('id') id: string) {
    return this.staff.remove(r[AUTH_USER_ID], id);
  }
  @Post('staff/invitations/:id/acceptances')
  accept(@Req() r: AuthenticatedRequest, @Param('id') id: string) {
    return this.staff.accept(r[AUTH_USER_ID], id);
  }
  @Get('staff/workplaces')
  workplaces(@Req() r: AuthenticatedRequest) {
    return this.staff.workplaces(r[AUTH_USER_ID]);
  }
}

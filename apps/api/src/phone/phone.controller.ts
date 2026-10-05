import { Body, Controller, Get, Inject, Post, Req } from '@nestjs/common';
import { AUTH_USER_ID } from '../auth/session.guard.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { PhoneService } from './phone.service.js';

@Controller('phone')
export class PhoneController {
  constructor(@Inject(PhoneService) private readonly phone: PhoneService) {}
  @Get()
  status(@Req() r: AuthenticatedRequest) {
    return this.phone.status(r[AUTH_USER_ID]);
  }
  @Post('challenges')
  request(@Req() r: AuthenticatedRequest, @Body() body: unknown) {
    return this.phone.requestCode(r[AUTH_USER_ID], body);
  }
  @Post('verifications')
  verify(@Req() r: AuthenticatedRequest, @Body() body: unknown) {
    return this.phone.verify(r[AUTH_USER_ID], body);
  }
}

import { Controller, Get, Inject, Post, Req } from '@nestjs/common';
import { AUTH_USER_ID } from '../auth/session.guard.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { NotificationsService } from './notifications.service.js';

@Controller('notifications')
export class NotificationsController {
  constructor(
    @Inject(NotificationsService)
    private readonly notifications: NotificationsService,
  ) {}
  @Get()
  list(@Req() r: AuthenticatedRequest) {
    return this.notifications.list(r[AUTH_USER_ID]);
  }
  @Post('seen')
  seen(@Req() r: AuthenticatedRequest) {
    return this.notifications.markSeen(r[AUTH_USER_ID]);
  }
}

import { Controller, Get, Inject, Param, Query, Req } from '@nestjs/common';
import { AUTH_USER_ID } from '../auth/session.guard.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { TaskQueriesService } from './task-queries.service.js';
@Controller('work')
export class TaskQueriesController {
  constructor(
    @Inject(TaskQueriesService) private readonly queries: TaskQueriesService,
  ) {}
  @Get('tasks')
  discover(@Req() r: AuthenticatedRequest, @Query() query: unknown) {
    return this.queries.discover(r[AUTH_USER_ID], query);
  }
  @Get('claims')
  mine(@Req() r: AuthenticatedRequest, @Query() query: unknown) {
    return this.queries.mine(r[AUTH_USER_ID], query);
  }
  @Get('sponsor/tasks')
  sponsors(@Req() r: AuthenticatedRequest, @Query() query: unknown) {
    return this.queries.sponsorTasks(r[AUTH_USER_ID], query);
  }
  @Get('tasks/:id/claims')
  participants(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    return this.queries.participants(r[AUTH_USER_ID], id, query);
  }
}

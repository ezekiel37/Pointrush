import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { AccountsService } from '../accounts/accounts.service.js';
import {
  AdminMfaRequired,
  AUTH_USER_ID,
} from '../auth/session.guard.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { TaskReviewService } from './task-review.service.js';

@Controller('admin/reviews')
@AdminMfaRequired()
export class ReviewsController {
  constructor(
    private readonly reviews: TaskReviewService,
    private readonly accounts: AccountsService,
  ) {}

  @Get('tasks')
  async list(@Req() request: AuthenticatedRequest) {
    return this.reviews.listPending(await this.accountId(request));
  }

  @Get('tasks/:taskId')
  async get(
    @Req() request: AuthenticatedRequest,
    @Param('taskId') taskId: string,
  ) {
    return this.reviews.getPending(await this.accountId(request), taskId);
  }

  @Post('tasks/:taskId/decision')
  async decide(
    @Req() request: AuthenticatedRequest,
    @Param('taskId') taskId: string,
    @Body() input: unknown,
  ) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new ForbiddenException('Invalid review command');
    return this.reviews.decide(await this.accountId(request), {
      ...(input as Record<string, unknown>),
      taskId,
    });
  }

  private async accountId(request: AuthenticatedRequest): Promise<string> {
    const result = await this.accounts.getForAuth(request[AUTH_USER_ID]);
    if (result.onboarding !== 'complete' || !result.account)
      throw new ForbiddenException('PointRush account is required');
    return result.account.id;
  }
}

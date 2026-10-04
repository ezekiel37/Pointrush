import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { AccountsService } from '../accounts/accounts.service.js';
import { AdminMfaRequired, AUTH_USER_ID } from '../auth/session.guard.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { TaskReviewService } from './task-review.service.js';

@Controller('admin/reviews')
@AdminMfaRequired()
export class ReviewsController {
  constructor(
    @Inject(TaskReviewService) private readonly reviews: TaskReviewService,
    @Inject(AccountsService) private readonly accounts: AccountsService,
  ) {}

  @Get('tasks')
  async list(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return this.reviews.listPending(await this.accountId(request), query);
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
      throw new BadRequestException('Invalid review command');
    if ('taskId' in input)
      throw new BadRequestException('Task identifier belongs in the route');
    return this.reviews.decide(await this.accountId(request), {
      ...(input as Record<string, unknown>),
      taskId,
    });
  }

  private async accountId(request: AuthenticatedRequest): Promise<string> {
    const result = await this.accounts.getForAuth(request[AUTH_USER_ID]);
    if (result.onboarding !== 'complete' || !result.account)
      throw new ForbiddenException('Acticlaim account is required');
    return result.account.id;
  }
}

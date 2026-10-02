import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { AdminMfaRequired, AUTH_USER_ID } from '../auth/session.guard.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { TaskWorkService } from './task-work.service.js';

@Controller('work')
export class TaskWorkController {
  constructor(
    @Inject(TaskWorkService) private readonly work: TaskWorkService,
  ) {}
  @Get('tasks/:id')
  task(@Req() r: AuthenticatedRequest, @Param('id') id: string) {
    return this.work.readTask(r[AUTH_USER_ID], id);
  }
  @Post('tasks/:id/publish')
  publish(@Req() r: AuthenticatedRequest, @Param('id') id: string) {
    return this.work.publish(r[AUTH_USER_ID], id);
  }
  @Post('tasks/:id/join')
  join(@Req() r: AuthenticatedRequest, @Param('id') id: string) {
    return this.work.join(r[AUTH_USER_ID], id);
  }
  @Get('claims/:id')
  claim(@Req() r: AuthenticatedRequest, @Param('id') id: string) {
    return this.work.readClaim(r[AUTH_USER_ID], id);
  }
  @Post('claims/:id/proofs')
  submit(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.work.submit(r[AUTH_USER_ID], id, body);
  }
  @Post('proofs/:id/decisions')
  decide(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.work.decide(r[AUTH_USER_ID], id, body);
  }
  @Post('proofs/:id/appeals')
  appeal(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.work.appeal(r[AUTH_USER_ID], id, body);
  }
  @Post('proofs/:id/acknowledgements')
  acknowledge(@Req() r: AuthenticatedRequest, @Param('id') id: string) {
    return this.work.acknowledge(r[AUTH_USER_ID], id);
  }
  @Get('appeals/:id')
  @AdminMfaRequired()
  readAppeal(@Req() r: AuthenticatedRequest, @Param('id') id: string) {
    return this.work.readAppeal(r[AUTH_USER_ID], id);
  }
  @Post('appeals/:id/resolutions')
  @AdminMfaRequired()
  resolve(
    @Req() r: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.work.resolve(r[AUTH_USER_ID], id, body);
  }
}

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Delete,
  Param,
  Req,
} from '@nestjs/common';
import {
  AccountStatusRead,
  AUTH_SESSION_ID,
  AUTH_USER_ID,
} from './session.guard.js';
import type { AuthenticatedRequest } from './session.guard.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { SessionManagementService } from './session-management.js';

@Controller('accounts')
export class AuthController {
  constructor(
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(SessionManagementService)
    private readonly sessions: SessionManagementService,
  ) {}

  @Get('me')
  @AccountStatusRead()
  async getAccount(@Req() request: AuthenticatedRequest) {
    return this.accounts.getForAuth(request[AUTH_USER_ID]);
  }

  @Post('me')
  @HttpCode(HttpStatus.CREATED)
  async createAccount(
    @Req() request: AuthenticatedRequest,
    @Body() input: unknown,
  ) {
    return this.accounts.createForAuth(request[AUTH_USER_ID], input);
  }

  @Get('sessions')
  async listSessions(@Req() request: AuthenticatedRequest) {
    return this.sessions.list(request[AUTH_USER_ID], request[AUTH_SESSION_ID]);
  }

  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.OK)
  async revokeSession(
    @Req() request: AuthenticatedRequest,
    @Param('sessionId') sessionId: string,
  ) {
    return this.sessions.revoke(request[AUTH_USER_ID], sessionId);
  }

  @Post('sessions/revoke-others')
  async revokeOtherSessions(@Req() request: AuthenticatedRequest) {
    return this.sessions.revokeOthers(
      request[AUTH_USER_ID],
      request[AUTH_SESSION_ID],
    );
  }
}

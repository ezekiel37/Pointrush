import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
} from '@nestjs/common';
import { AccountStatusRead, AUTH_USER_ID } from './session.guard.js';
import type { AuthenticatedRequest } from './session.guard.js';
import { AccountsService } from '../accounts/accounts.service.js';

@Controller('accounts')
export class AuthController {
  constructor(
    @Inject(AccountsService) private readonly accounts: AccountsService,
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
}

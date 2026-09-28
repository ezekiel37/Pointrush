import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AccountsService } from '../accounts/accounts.service.js';
import { AuthService } from './auth.service.js';

@Controller('accounts')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AccountsService) private readonly accounts: AccountsService,
  ) {}

  @Post('me')
  @HttpCode(HttpStatus.CREATED)
  async createAccount(@Req() request: Request, @Body() input: unknown) {
    const session = await this.auth.getSession(request.headers);
    if (!session) throw new UnauthorizedException('Authentication required');
    return this.accounts.createForAuth(session.user.id, input);
  }
}

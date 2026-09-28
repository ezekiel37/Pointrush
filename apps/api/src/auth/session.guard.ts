import {
  ForbiddenException,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthService } from './auth.service.js';
import type { AccountsService } from '../accounts/accounts.service.js';

const PUBLIC_ROUTE = Symbol('PUBLIC_ROUTE');
export const PublicRoute = () => SetMetadata(PUBLIC_ROUTE, true);
const ACCOUNT_STATUS_READ = Symbol('ACCOUNT_STATUS_READ');
// Only for reading the caller's own status; never a business permission.
export const AccountStatusRead = () => SetMetadata(ACCOUNT_STATUS_READ, true);
export const AUTH_USER_ID = Symbol('AUTH_USER_ID');
export type AuthenticatedRequest = Request & { [AUTH_USER_ID]: string };

export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accounts: AccountsService,
    private readonly auth?: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    if (!this.auth) throw new UnauthorizedException('Authentication required');
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method))
      this.auth.assertTrustedOrigin(request.headers.origin);
    const session = await this.auth.getSession(request.headers);
    if (!session) throw new UnauthorizedException('Authentication required');
    if (!session.user.emailVerified)
      throw new ForbiddenException('Verified email is required');
    const statusRead =
      ['GET', 'HEAD'].includes(request.method) &&
      this.reflector.get<boolean>(ACCOUNT_STATUS_READ, context.getHandler());
    if (!statusRead) await this.accounts.assertAuthAccess(session.user.id);
    request[AUTH_USER_ID] = session.user.id;
    return true;
  }
}

import {
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { AUTH_USER_ID } from '../auth/session.guard.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';

export type Policy = { limit: number; windowMs: number };
const RATE_LIMIT = Symbol('RATE_LIMIT');
// Overrides the default policy for one route (or its whole controller).
export const RateLimit = (policy: Policy) => SetMetadata(RATE_LIMIT, policy);

export const defaultPolicies = {
  // Signed-in reads and writes, per account.
  read: { limit: 300, windowMs: 60000 },
  write: { limit: 60, windowMs: 60000 },
  // Public routes share one ceiling per route across all visitors. Visitor
  // IPs are not trusted here (see INGRESS.md), so per-visitor limits belong
  // at the edge; this ceiling only caps total load.
  public: { limit: 1200, windowMs: 60000 },
};

// Fixed-window counters held in this process. With several API instances the
// effective limit is per instance; it is a first layer, not the only one.
export class RateLimiter {
  private readonly windows = new Map<
    string,
    { start: number; count: number }
  >();
  constructor(private readonly now: () => number = Date.now) {}

  hit(key: string, policy: Policy) {
    const now = this.now();
    if (this.windows.size > 50000) this.prune(now);
    let window = this.windows.get(key);
    if (!window || now - window.start >= policy.windowMs) {
      window = { start: now, count: 0 };
      this.windows.set(key, window);
    }
    window.count += 1;
    const retryAfter = Math.ceil((window.start + policy.windowMs - now) / 1000);
    return { allowed: window.count <= policy.limit, retryAfter };
  }

  private prune(now: number) {
    for (const [key, window] of this.windows)
      if (now - window.start >= 3600000) this.windows.delete(key);
  }
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiter = new RateLimiter(),
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request[AUTH_USER_ID] as string | undefined;
    const write = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    const custom = this.reflector.getAllAndOverride<Policy | undefined>(
      RATE_LIMIT,
      [context.getHandler(), context.getClass()],
    );
    const route = `${context.getClass().name}.${context.getHandler().name}`;
    const [key, policy] = user
      ? custom
        ? [`account:${user}:${route}`, custom]
        : [
            `account:${user}:${write ? 'write' : 'read'}`,
            write ? defaultPolicies.write : defaultPolicies.read,
          ]
      : [`public:${route}`, custom ?? defaultPolicies.public];
    const result = this.limiter.hit(key, policy);
    if (result.allowed) return true;
    context
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Retry-After', String(result.retryAfter));
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Too many requests; slow down and try again shortly',
        reason: 'rate_limited',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

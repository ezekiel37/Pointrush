import { ForbiddenException, Injectable } from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createAuthNodeHandler } from './auth.http.js';
import type { createAuth } from './auth.factory.js';

export type PointRushAuth = ReturnType<typeof createAuth>;

@Injectable()
export class AuthService {
  constructor(
    private readonly auth: PointRushAuth,
    private readonly baseURL: string,
    private readonly trustedOrigins: string[] = [],
  ) {}

  assertTrustedOrigin(origin: string | undefined): void {
    if (!origin || ![this.baseURL, ...this.trustedOrigins].includes(origin)) {
      throw new ForbiddenException('A trusted request origin is required');
    }
  }

  get handler(): (
    request: IncomingMessage,
    response: ServerResponse,
  ) => Promise<void> {
    return createAuthNodeHandler(this.auth, this.baseURL);
  }

  getSession(
    headers: IncomingMessage['headers'],
  ): ReturnType<PointRushAuth['api']['getSession']> {
    return this.auth.api.getSession({ headers: fromNodeHeaders(headers) });
  }

  // Re-checks the signed-in person's password before a sensitive action, so a
  // stolen session alone cannot move money.
  async verifyPassword(
    headers: IncomingMessage['headers'],
    password: string,
  ): Promise<boolean> {
    try {
      const result = await this.auth.api.verifyPassword({
        headers: fromNodeHeaders(headers),
        body: { password },
      });
      return result.status === true;
    } catch {
      return false;
    }
  }
}

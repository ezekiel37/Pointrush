import { Injectable } from '@nestjs/common';
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
  ) {}

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
}

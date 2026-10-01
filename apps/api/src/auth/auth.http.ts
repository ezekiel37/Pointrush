import type { IncomingMessage, ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { getRequest, setResponse } from 'better-call/node';
import type { PointRushAuth } from './auth.service.js';
import {
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';

const AUTH_BODY_LIMIT = 64 * 1024;

export function createAuthNodeHandler(
  auth: PointRushAuth,
  baseURL: string,
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  return async (request, response) => {
    if (Number(request.headers['content-length']) > AUTH_BODY_LIMIT) {
      throw new PayloadTooLargeException(
        'Request body exceeds the allowed size',
      );
    }
    // Never trust a client-supplied forwarding header. Deployment-specific proxy
    // handling must be validated before a proxy-derived address is used here.
    delete request.headers['x-pointrush-client-ip'];
    const address = request.socket.remoteAddress;
    // Missing transport identity must not silently bypass IP rate limiting.
    if (!address || !isIP(address)) throw new ServiceUnavailableException();
    request.headers['x-pointrush-client-ip'] = address;
    const webRequest = getRequest({
      base: baseURL,
      request,
      bodySizeLimit: AUTH_BODY_LIMIT,
    });
    const result = await auth.handler(webRequest);
    await setResponse(response, result);
  };
}

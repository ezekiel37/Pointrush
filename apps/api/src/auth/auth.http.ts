import type { IncomingMessage, ServerResponse } from 'node:http';
import { getRequest, setResponse } from 'better-call/node';
import type { PointRushAuth } from './auth.service.js';

const AUTH_BODY_LIMIT = 64 * 1024;

export function createAuthNodeHandler(
  auth: PointRushAuth,
  baseURL: string,
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  return async (request, response) => {
    // Never trust a client-supplied forwarding header. Deployment-specific proxy
    // handling must be validated before a proxy-derived address is used here.
    delete request.headers['x-pointrush-client-ip'];
    if (request.socket.remoteAddress) {
      request.headers['x-pointrush-client-ip'] = request.socket.remoteAddress;
    }
    const webRequest = getRequest({
      base: `${baseURL}/api/v1/auth`,
      request,
      bodySizeLimit: AUTH_BODY_LIMIT,
    });
    const result = await auth.handler(webRequest);
    await setResponse(response, result);
  };
}

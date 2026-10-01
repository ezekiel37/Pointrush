import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { ServiceUnavailableException } from '@nestjs/common';
import { createAuthNodeHandler } from '../src/auth/auth.http.js';
import type { PointRushAuth } from '../src/auth/auth.service.js';

test('missing transport identity fails before auth and discards forged internal header', async () => {
  let called = false;
  const auth = {
    handler: async () => {
      called = true;
      return new Response();
    },
  } as unknown as PointRushAuth;
  const request = new IncomingMessage(new Socket());
  request.headers['x-pointrush-client-ip'] = '203.0.113.1';
  request.headers['cf-connecting-ip'] = '203.0.113.2';
  await assert.rejects(
    createAuthNodeHandler(auth, 'https://api.example.test')(
      request,
      new ServerResponse(request),
    ),
    ServiceUnavailableException,
  );
  assert.equal(called, false);
  assert.equal(request.headers['x-pointrush-client-ip'], undefined);
  request.destroy();
});

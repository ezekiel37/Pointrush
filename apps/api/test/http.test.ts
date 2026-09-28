import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Body, Controller, Get, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { IsInt, Min } from 'class-validator';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureHttp } from '../src/http/configure-http.js';
import { PublicRoute } from '../src/auth/session.guard.js';

class ProbeDto {
  @IsInt()
  @Min(1)
  count!: number;
}

// Fixtures only exist in this test module, never the production app.
@Controller('probe')
@PublicRoute()
class ProbeController {
  @Post()
  validate(@Body() input: ProbeDto): ProbeDto {
    return input;
  }

  @Get('failure')
  failure(): never {
    throw new Error('secret-provider-token');
  }
}

let app: NestExpressApplication;
let server: Parameters<typeof request>[0];

before(async () => {
  const module = await Test.createTestingModule({
    imports: [AppModule.forRoot()],
    controllers: [ProbeController],
  }).compile();
  app = module.createNestApplication<NestExpressApplication>({
    logger: false,
    rawBody: true,
  });
  configureHttp(
    app,
    {
      nodeEnv: 'test',
      port: 8080,
      corsOrigins: ['https://app.example.com'],
    },
    async (request, response) => {
      let body = '';
      for await (const chunk of request)
        body += Buffer.from(chunk).toString('utf8');
      response.statusCode = 200;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ body }));
    },
  );
  await app.init();
  server = app.getHttpServer() as Parameters<typeof request>[0];
});

after(async () => {
  await app?.close();
});

test('liveness is small, uncached, and has security headers', async () => {
  const response = await request(server).get('/api/v1/health/live').expect(200);
  assert.deepEqual(response.body, { status: 'ok' });
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['x-powered-by'], undefined);
  assert.match(String(response.headers['x-request-id']), /^[0-9a-f-]{36}$/);
});

test('an unconfigured database reports not ready while liveness stays healthy', async () => {
  await request(server).get('/api/v1/health/ready').expect(503);
  await request(server).get('/api/v1/health/live').expect(200);
});

test('request identifiers cannot be supplied by the caller', async () => {
  const first = await request(server)
    .get('/api/v1/health/live')
    .set('X-Request-Id', 'attacker-controlled')
    .expect(200);
  const second = await request(server).get('/api/v1/health/live').expect(200);
  assert.notEqual(first.headers['x-request-id'], 'attacker-controlled');
  assert.notEqual(
    first.headers['x-request-id'],
    second.headers['x-request-id'],
  );
});

test('CORS grants only exact allowlisted origins', async () => {
  const allowed = await request(server)
    .get('/api/v1/health/live')
    .set('Origin', 'https://app.example.com');
  assert.equal(
    allowed.headers['access-control-allow-origin'],
    'https://app.example.com',
  );
  for (const origin of [
    'https://app.example.com.evil.test',
    'null',
    'https://other.example.com',
  ]) {
    const blocked = await request(server)
      .get('/api/v1/health/live')
      .set('Origin', origin);
    assert.equal(blocked.headers['access-control-allow-origin'], undefined);
  }
});

test('authentication handler runs before ordinary body parsers', async () => {
  const response = await request(server)
    .post('/api/v1/auth/test')
    .send({ password: 'body-is-owned-by-auth' })
    .expect(200);
  assert.deepEqual(JSON.parse(response.body.body), {
    password: 'body-is-owned-by-auth',
  });
  assert.equal(response.headers['access-control-allow-credentials'], 'true');
});

test('valid DTO reaches controller', async () => {
  const response = await request(server)
    .post('/api/v1/probe')
    .send({ count: 2 })
    .expect(201);
  assert.deepEqual(response.body, { count: 2 });
});

for (const payload of [
  { count: '2' },
  { count: 0 },
  {},
  { count: 2, admin: true },
  { count: null },
  [],
]) {
  test(`rejects invalid DTO ${JSON.stringify(payload)}`, async () => {
    const response = await request(server)
      .post('/api/v1/probe')
      .send(payload)
      .expect(400);
    assert.equal(response.body.requestId, response.headers['x-request-id']);
  });
}

test('malformed JSON is rejected without echoing the body', async () => {
  const response = await request(server)
    .post('/api/v1/probe')
    .set('Content-Type', 'application/json')
    .send('{"secret-token":')
    .expect(400);
  assert.ok(!JSON.stringify(response.body).includes('secret-token'));
  assert.equal(response.body.message, 'Malformed request body');
});

test('oversized body is rejected', async () => {
  await request(server)
    .post('/api/v1/probe')
    .send({ value: 'x'.repeat(70 * 1024) })
    .expect(413);
});

test('unexpected errors hide sensitive details and retain request identifier', async () => {
  const response = await request(server)
    .get('/api/v1/probe/failure')
    .expect(500);
  assert.deepEqual(response.body, {
    statusCode: 500,
    message: 'Internal server error',
    requestId: response.headers['x-request-id'],
  });
});

test('unknown endpoints do not expose stack traces', async () => {
  const response = await request(server)
    .get('/api/v1/missing?token=secret-token')
    .expect(404);
  assert.equal(response.body.stack, undefined);
  assert.ok(!JSON.stringify(response.body).includes('secret-token'));
  assert.equal(response.body.requestId, response.headers['x-request-id']);
});

test('account commands are not exposed before authentication is implemented', async () => {
  await request(server)
    .post('/api/v1/accounts')
    .send({ username: 'attacker', displayName: 'Attacker' })
    .expect(404);
  await request(server)
    .patch('/api/v1/accounts/username')
    .send({ username: 'attacker' })
    .expect(404);
});

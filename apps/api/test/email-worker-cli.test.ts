import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import type { Socket } from 'node:net';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test(
  'worker deadline terminates a stalled database connection without leaking credentials',
  { timeout: 10000 },
  async () => {
    const sockets = new Set<Socket>();
    // Accept PostgreSQL's connection but never answer: prove the CLI exits while
    // asynchronous work is still pending, rather than merely stopping between jobs.
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on('data', () => {});
      socket.on('close', () => sockets.delete(socket));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(
          new URL('../src/auth/email-worker-cli.js', import.meta.url),
        ),
      ],
      {
        env: {
          NODE_ENV: 'production',
          DATABASE_URL: `postgres://worker:do-not-log@127.0.0.1:${address.port}/test`,
          DATABASE_SSL_MODE: 'disable-local',
          RESEND_API_KEY: 're_do_not_log',
          AUTH_EMAIL_ENCRYPTION_KEY: 'ab'.repeat(32),
          EMAIL_WORKER_MAX_DURATION_MS: '1000',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    const emergency = setTimeout(() => child.kill('SIGKILL'), 6000);
    try {
      const [code, signal] = await once(child, 'close');
      assert.equal(signal, null);
      assert.equal(code, 1);
      assert.match(output, /auth_email_batch_deadline/);
      assert.doesNotMatch(output, /do-not-log|re_do_not_log|abababab/);
    } finally {
      clearTimeout(emergency);
      child.kill('SIGKILL');
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

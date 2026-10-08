import { test } from 'node:test';
import assert from 'node:assert/strict';

// Loaded fresh for each case: the module reads its settings when called.
const load = () => import(`../src/lib/api-origin.ts?${Math.random()}`);

test('without a built-in setting the browser uses api.<site>', async (t) => {
  delete process.env.NEXT_PUBLIC_API_ORIGIN;
  t.after(() => delete globalThis.window);
  const { apiOrigin } = await load();
  globalThis.window = { location: { hostname: 'www.acticlaim.com' } };
  assert.equal(apiOrigin(), 'https://api.acticlaim.com');
  globalThis.window = { location: { hostname: 'acticlaim.com' } };
  assert.equal(apiOrigin(), 'https://api.acticlaim.com');
  globalThis.window = { location: { hostname: 'localhost' } };
  assert.throws(() => apiOrigin(), /unavailable/);
});

test('a configured origin wins and must be HTTPS', async () => {
  delete globalThis.window;
  const { apiOrigin } = await load();
  process.env.NEXT_PUBLIC_API_ORIGIN = 'https://api.example.com';
  assert.equal(apiOrigin(), 'https://api.example.com');
  process.env.NEXT_PUBLIC_API_ORIGIN = 'http://api.example.com';
  assert.throws(() => apiOrigin(), /Invalid/);
  delete process.env.NEXT_PUBLIC_API_ORIGIN;
  assert.throws(() => apiOrigin(), /unavailable/);
});

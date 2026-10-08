import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

// Hosts that only build ./Dockerfile get the same API image as CI.
test('the root Dockerfile matches the API Dockerfile', () => {
  const body = (path: string) =>
    readFileSync(resolve(path), 'utf8')
      .split('\n')
      .filter((line) => !line.startsWith('#'))
      .join('\n')
      .trim();
  assert.equal(body('../../Dockerfile'), body('Dockerfile'));
});

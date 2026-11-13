import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { config } from './helpers.js';
import { parseConfig, readPrivateFile } from '../src/config.js';

test('configuration rejects unsafe URLs, ambiguous file locations and unknown settings', () => {
  for (const field of ['publicOrigin', 'bookstackUrl', 'issuer']) {
    for (const value of [
      'http://public.example.org',
      'https://user:pass@example.org',
      'https://example.org/#fragment',
      'https://example.org/?query=yes',
    ])
      assert.throws(() => parseConfig({ ...config, [field]: value }));
  }
  assert.throws(() => parseConfig({ ...config, publicOrigin: 'https://example.org/subpath' }));
  assert.throws(() => parseConfig({ ...config, databasePath: 'relative.sqlite' }));
  assert.throws(() => parseConfig({ ...config, keyringFile: config.databasePath }));
  assert.throws(() => parseConfig({ ...config, bypassAuth: true }));
  assert.throws(() =>
    parseConfig({ ...config, allowInsecureLocalhost: true, issuer: 'http://public.example.org' }),
  );
  assert.equal(
    parseConfig({
      ...config,
      allowInsecureLocalhost: true,
      issuer: 'http://127.0.0.1:8080/realms/local',
    }).issuer,
    'http://127.0.0.1:8080/realms/local',
  );
});
test('secret files require private permissions and cannot be symlinks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bookstack-permissions-'));
  const file = join(dir, 'key');
  try {
    writeFileSync(file, 'secret', { mode: 0o600 });
    assert.equal(readPrivateFile(file), 'secret');
    chmodSync(file, 0o644);
    assert.throws(() => readPrivateFile(file));
    chmodSync(file, 0o600);
    symlinkSync(file, join(dir, 'link'));
    assert.throws(() => readPrivateFile(join(dir, 'link')));
  } finally {
    rmSync(dir, { recursive: true });
  }
});

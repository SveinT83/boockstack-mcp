// Explicit local simulation for verifying the compiled executable. Never used by production startup.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';

const dir = mkdtempSync(join(tmpdir(), 'bookstack-runtime-smoke-'));
let issuer: string;
const idp = createServer((_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(
    JSON.stringify({
      issuer,
      authorization_endpoint: `${issuer}/auth`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      code_challenge_methods_supported: ['S256'],
    }),
  );
});
let child: ChildProcess | undefined;
try {
  idp.listen(0, '127.0.0.1');
  await once(idp, 'listening');
  issuer = `http://127.0.0.1:${(idp.address() as AddressInfo).port}`;
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = (reservation.address() as AddressInfo).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const publicOrigin = `http://127.0.0.1:${port}`;
  writeFileSync(join(dir, 'secret'), 'local-test-client-secret', { mode: 0o600 });
  writeFileSync(
    join(dir, 'keyring.json'),
    JSON.stringify({ activeKeyId: 'test', keys: { test: randomBytes(32).toString('base64') } }),
    { mode: 0o600 },
  );
  writeFileSync(
    join(dir, 'config.json'),
    JSON.stringify({
      publicOrigin,
      issuer,
      bookstackUrl: 'http://127.0.0.1:1',
      webClientId: 'local-test',
      webClientSecretFile: join(dir, 'secret'),
      keyringFile: join(dir, 'keyring.json'),
      databasePath: join(dir, 'state', 'vault.sqlite'),
      port,
      allowInsecureLocalhost: true,
    }),
  );
  child = spawn(process.execPath, ['dist/main.js'], {
    env: { ...process.env, BOOKSTACK_MCP_CONFIG: join(dir, 'config.json') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Compiled server did not start in 15s')),
      15_000,
    );
    child!.stdout!.on('data', (data) => {
      output += data.toString();
      if (output.includes('"event":"started"')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child!.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Compiled server exited early (${code})`));
    });
    child!.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
  assert.equal((await fetch(`${publicOrigin}/healthz`)).status, 200);
  assert.equal((await fetch(`${publicOrigin}/`)).status, 200);
  const metadata = await (
    await fetch(`${publicOrigin}/.well-known/oauth-protected-resource/mcp`)
  ).json();
  assert.equal(metadata.resource, `${publicOrigin}/mcp`);
  const anonymous = await fetch(`${publicOrigin}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  assert.equal(anonymous.status, 401);
  assert(anonymous.headers.get('x-correlation-id'));
  assert.equal((await fetch(`${publicOrigin}/setup`, { redirect: 'manual' })).status, 302);
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const [code] = await exited;
  assert.equal(code, 0);
  child = undefined;
  console.log(
    'PASS: compiled Node runtime, local mock OIDC discovery, SQLite initialization, liveness, metadata, anonymous rejection, protected setup, graceful shutdown. No production access.',
  );
} finally {
  if (child && child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
  }
  idp.close();
  idp.closeAllConnections();
  await once(idp, 'close');
  rmSync(dir, { recursive: true, force: true });
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalJWKSet, generateKeyPair, SignJWT } from 'jose';
import { alice, config, keypair, jwk, token, verifier, fixture } from './helpers.js';
import { resource } from '../src/config.js';
import { TokenVerifier } from '../src/auth.js';

async function signed(claims: Record<string, unknown>, key = keypair.privateKey) {
  return new SignJWT({
    iss: config.issuer,
    aud: resource(config),
    sub: 'alice',
    exp: Math.floor(Date.now() / 1000) + 600,
    iat: Math.floor(Date.now() / 1000),
    scope: 'bookstack:read',
    typ: 'Bearer',
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .sign(key);
}
test('valid signed access token resolves only validated issuer and subject', async () => {
  const p = await verifier.verify(await token('alice', { email: 'bob@example.org' }));
  assert.equal(p.subject, alice.subject);
  assert.equal(p.issuer, config.issuer);
});
for (const [name, claims] of Object.entries({
  issuer: { iss: 'https://attacker.example.org' },
  audience: { aud: 'another-api' },
  expired: { exp: 1 },
  noExpiry: { exp: undefined },
  noSubject: { sub: undefined },
  emptySubject: { sub: '' },
  noIssuedAt: { iat: undefined },
  futureIssuedAt: { iat: 9999999999 },
  notBefore: { nbf: 9999999999 },
  idToken: { typ: 'ID' },
  refreshToken: { typ: 'Refresh' },
  missingScope: { scope: 'openid profile' },
}))
  test(`reject ${name}`, async () => {
    await assert.rejects(() => signed(claims).then((t) => verifier.verify(t)));
  });
test('reject invalid signature and unsigned/malformed tokens', async () => {
  const other = await generateKeyPair('RS256');
  await assert.rejects(() => signed({}, other.privateKey).then((t) => verifier.verify(t)));
  await assert.rejects(() => verifier.verify('not.a.token'));
});
test('accept expected audience within array; never use email as account key', async () => {
  const v = new TokenVerifier(config, createLocalJWKSet({ keys: [jwk] }));
  assert.equal(
    (
      await v.verify(
        await signed({ aud: ['account', resource(config)], email: 'admin@example.org' }),
      )
    ).subject,
    'alice',
  );
});
for (const method of ['tools/list', 'tools/call', 'initialize', 'resources/list', 'prompts/list'])
  test(`unauthenticated ${method} has 401 and discovery challenge`, async () => {
    const f = fixture();
    try {
      const r = await f.mcp(method);
      assert.equal(r.status, 401);
      assert.match(r.headers['www-authenticate'], /oauth-protected-resource\/mcp/);
      assert.equal(r.body.code, 'MCP_LOGIN_REQUIRED');
    } finally {
      await f.close();
    }
  });
test('invalid JWT is rejected before upstream requests', async () => {
  let requests = 0;
  const f = fixture(async () => {
    requests++;
    return Response.json({});
  });
  try {
    const r = await f.call('bookstack_read', { kind: 'pages', id: 1 }, 'bad.token.signature');
    assert.equal(r.status, 401);
    assert.equal(requests, 0);
  } finally {
    await f.close();
  }
});
test('missing read scope produces complete scope challenge', async () => {
  const f = fixture();
  try {
    const r = await f.mcp('tools/list', {}, await signed({ scope: 'openid' }));
    assert.equal(r.status, 403);
    assert.match(r.headers['www-authenticate'], /insufficient_scope/);
    assert.match(r.headers['www-authenticate'], /bookstack:read/);
  } finally {
    await f.close();
  }
});
test('unauthenticated GET and DELETE MCP session operations are also rejected', async () => {
  const f = fixture();
  try {
    for (const method of ['get', 'delete'] as const) {
      const r = await f.http()[method]('/mcp').set('Host', f.host);
      assert.equal(r.status, 401);
    }
  } finally {
    await f.close();
  }
});

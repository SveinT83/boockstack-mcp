import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as httpServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, generateKeyPair } from 'jose';
import { createIdentityProvider, type LoginAttempt } from '../src/auth.js';
import { config as baseConfig, keypair, jwk } from './helpers.js';
import { resource } from '../src/config.js';

async function provider() {
  const dir = mkdtempSync(join(tmpdir(), 'bookstack-oidc-'));
  const secretFile = join(dir, 'secret');
  writeFileSync(secretFile, 'test-client-secret', { mode: 0o600 });
  let issuer: string;
  let attempt: LoginAttempt;
  let scenario: 'ok' | 'nonce' | 'idSignature' | 'subject' | 'audience' = 'ok';
  const otherPair = await generateKeyPair('RS256');
  const seen: URLSearchParams[] = [];
  const server = httpServer(async (req, res) => {
    try {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/realms/test/.well-known/openid-configuration') {
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
            token_endpoint_auth_methods_supported: ['client_secret_post'],
            authorization_response_iss_parameter_supported: true,
          }),
        );
        return;
      }
      if (req.url === '/realms/test/jwks') {
        res.end(JSON.stringify({ keys: [jwk] }));
        return;
      }
      if (req.url === '/realms/test/token') {
        let body = '';
        for await (const chunk of req) body += chunk;
        const params = new URLSearchParams(body);
        seen.push(params);
        assert.equal(params.get('client_secret'), 'test-client-secret');
        assert.equal(params.get('grant_type'), 'authorization_code');
        assert.equal(params.get('code_verifier'), attempt.verifier);
        assert.equal(params.get('resource'), resource(config));
        assert.equal(params.get('redirect_uri'), `${config.publicOrigin}/auth/callback`);
        const access = await new SignJWT({ typ: 'Bearer', scope: 'bookstack:read' })
          .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
          .setIssuer(issuer)
          .setSubject(scenario === 'subject' ? 'other-user' : 'oidc-user')
          .setAudience(scenario === 'audience' ? 'wrong-api' : resource(config))
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(keypair.privateKey);
        const idToken = await new SignJWT({
          nonce: scenario === 'nonce' ? 'wrong-nonce' : attempt.nonce,
        })
          .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
          .setIssuer(issuer)
          .setSubject('oidc-user')
          .setAudience(config.webClientId)
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(scenario === 'idSignature' ? otherPair.privateKey : keypair.privateKey);
        res.end(
          JSON.stringify({
            access_token: access,
            id_token: idToken,
            token_type: 'Bearer',
            expires_in: 300,
            scope: 'openid profile bookstack:read',
          }),
        );
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    } catch {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'invalid_request' }));
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}/realms/test`;
  const config = {
    ...baseConfig,
    issuer,
    webClientSecretFile: secretFile,
    allowInsecureLocalhost: true,
  };
  const idp = await createIdentityProvider(config);
  const fresh = () => {
    attempt = {
      state: randomBytes(32).toString('base64url'),
      nonce: randomBytes(32).toString('base64url'),
      verifier: randomBytes(32).toString('base64url'),
    };
    return attempt;
  };
  const callback = (state = attempt.state) =>
    new URL(
      `${config.publicOrigin}/auth/callback?code=local-test&state=${state}&iss=${encodeURIComponent(issuer)}`,
    );
  const close = async () => {
    server.close();
    server.closeAllConnections();
    await once(server, 'close');
    rmSync(dir, { recursive: true });
  };
  return {
    idp,
    config,
    seen,
    fresh,
    callback,
    scenario: (s: typeof scenario) => {
      scenario = s;
    },
    close,
  };
}
test('real openid-client library completes local discovery, PKCE, nonce, JWKS and token validation', async () => {
  const p = await provider();
  try {
    const attempt = p.fresh(),
      url = new URL(await p.idp.login(attempt));
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(
      url.searchParams.get('code_challenge'),
      createHash('sha256').update(attempt.verifier).digest('base64url'),
    );
    assert.equal(url.searchParams.get('resource'), resource(p.config));
    assert.equal(url.searchParams.get('nonce'), attempt.nonce);
    const principal = await p.idp.callback(p.callback(), attempt);
    assert.equal(principal.subject, 'oidc-user');
    assert.equal(principal.issuer, p.config.issuer);
    assert.equal(p.seen.length, 1);
  } finally {
    await p.close();
  }
});
for (const scenario of ['nonce', 'idSignature', 'subject', 'audience'] as const)
  test(`real OIDC exchange rejects ${scenario}`, async () => {
    const p = await provider();
    try {
      p.scenario(scenario);
      const attempt = p.fresh();
      await assert.rejects(
        () => p.idp.callback(p.callback(), attempt),
        /Innloggingen kunne ikke bekreftes/,
      );
    } finally {
      await p.close();
    }
  });
test('real OIDC exchange rejects state mismatch before token request', async () => {
  const p = await provider();
  try {
    const attempt = p.fresh();
    await assert.rejects(() => p.idp.callback(p.callback('wrong'), attempt));
    assert.equal(p.seen.length, 0);
  } finally {
    await p.close();
  }
});

import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK } from 'jose';
import { randomBytes } from 'node:crypto';
import { parseConfig, READ_SCOPE, WRITE_SCOPE, resource } from '../src/config.js';
import {
  TokenVerifier,
  type Principal,
  type IdentityProvider,
  type LoginAttempt,
} from '../src/auth.js';
import { Vault } from '../src/vault.js';
import { Store } from '../src/store.js';
import { BookStack } from '../src/bookstack.js';
import { createApp } from '../src/app.js';
import request from 'supertest';

export const config = parseConfig({
  publicOrigin: 'https://bookstack-mcp.example.org',
  issuer: 'https://idp.example.org/realms/staff',
  webClientId: 'bookstack-web',
  webClientSecretFile: '/run/secrets/client',
  keyringFile: '/run/secrets/keyring',
  databasePath: '/data/credentials.sqlite',
});
export const keypair = await generateKeyPair('RS256');
export const jwk = {
  ...(await exportJWK(keypair.publicKey)),
  kid: 'test-key',
  alg: 'RS256',
  use: 'sig',
};
export const verifier = new TokenVerifier(config, createLocalJWKSet({ keys: [jwk] }));
export const alice: Principal = {
  issuer: config.issuer,
  subject: 'alice',
  scopes: [READ_SCOPE, WRITE_SCOPE],
  expiresAt: Math.floor(Date.now() / 1000) + 600,
};
export const bob: Principal = { ...alice, subject: 'bob' };
export const aliceKey = { tokenId: 'AliceTokenId123456789', tokenSecret: 'AliceSecret1234567890' };
export const bobKey = { tokenId: 'BobbyTokenId123456789', tokenSecret: 'BobbySecret1234567890' };
export const keyring = { activeKeyId: 'k1', keys: { k1: randomBytes(32).toString('base64') } };
export async function token(
  subject = 'alice',
  overrides: Record<string, unknown> = {},
): Promise<string> {
  return new SignJWT({ typ: 'Bearer', scope: `${READ_SCOPE} ${WRITE_SCOPE}`, ...overrides })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(config.issuer)
    .setAudience(resource(config))
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(keypair.privateKey);
}
export function fixture(
  fetcher: typeof fetch = async () => Response.json({ version: 'v26.09.2' }),
) {
  const store = new Store(':memory:', new Vault(keyring));
  const records: Record<string, unknown>[] = [];
  let attempt: LoginAttempt;
  const idp: IdentityProvider = {
    verify: (t) => verifier.verify(t),
    async login(a) {
      attempt = a;
      return `https://idp.example.org/auth?state=${a.state}`;
    },
    async callback(_url, a) {
      if (a.state !== attempt.state) throw new Error('wrong state');
      return alice;
    },
  };
  const bookstack = new BookStack(config, fetcher);
  const service = createApp(config, store, idp, bookstack, (r) => records.push(r));
  const http = () => request(service.app);
  const host = new URL(config.publicOrigin).host;
  const mcp = async (method: string, params: unknown = {}, accessToken?: string) => {
    let req = http()
      .post('/mcp')
      .set('Host', host)
      .set('Accept', 'application/json, text/event-stream')
      .set('MCP-Protocol-Version', '2025-11-25');
    if (accessToken) req = req.set('Authorization', `Bearer ${accessToken}`);
    return req.send({ jsonrpc: '2.0', id: 1, method, params });
  };
  const call = (tool: string, args: unknown, accessToken?: string) =>
    mcp('tools/call', { name: tool, arguments: args }, accessToken);
  const login = async () => {
    const start = await http().get('/auth/login').set('Host', host);
    const cookie = (start.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    const state = new URL(start.headers.location).searchParams.get('state');
    const callback = await http()
      .get(`/auth/callback?state=${state}&code=test`)
      .set('Host', host)
      .set('Cookie', cookie);
    const session = (callback.headers['set-cookie'] as unknown as string[])
      .find((x) => x.startsWith('__Host-bookstack_session='))!
      .split(';')[0]!;
    const setup = await http().get('/setup').set('Host', host).set('Cookie', session);
    const csrf = /name="csrf" value="([^"]+)"/.exec(setup.text)![1]!;
    return { session, csrf, setup, start, callback };
  };
  const close = async () => {
    await service.close();
    store.close();
  };
  return { ...service, store, records, http, host, mcp, call, login, close, bookstack };
}
export const resultData = (response: request.Response) =>
  JSON.parse(response.body.result.content[0].text);

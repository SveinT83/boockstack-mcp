import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BookStack } from '../src/bookstack.js';
import { AppError } from '../src/errors.js';
import { aliceKey, config, fixture, alice, token } from './helpers.js';

for (const [status, code] of [
  [401, 'BOOKSTACK_KEY_REJECTED'],
  [403, 'BOOKSTACK_PERMISSION_DENIED'],
  [404, 'BOOKSTACK_NOT_FOUND'],
  [422, 'BOOKSTACK_VALIDATION'],
  [429, 'BOOKSTACK_RATE_LIMIT'],
  [500, 'BOOKSTACK_UPSTREAM'],
  [503, 'BOOKSTACK_UPSTREAM'],
] as const) {
  test(`BookStack ${status} maps to ${code} without exposing response body`, async () => {
    const api = new BookStack(config, async () =>
      Response.json({ error: { message: `unsafe-upstream-${aliceKey.tokenSecret}` } }, { status }),
    );
    await assert.rejects(
      () => api.read(aliceKey, 'pages', 1),
      (e: AppError) =>
        e.code === code && !e.message.includes(aliceKey.tokenSecret) && e.upstreamStatus === status,
    );
  });
}
for (const message of [
  'The authorization token used has expired',
  'Autorisasjonstokenet som er brukt, har utløpt',
])
  test(`expired API token with HTTP 403: ${message}`, async () => {
    const api = new BookStack(config, async () =>
      Response.json({ error: { message, code: 403 } }, { status: 403 }),
    );
    await assert.rejects(
      () => api.validate(aliceKey),
      (e: AppError) => e.code === 'BOOKSTACK_KEY_REJECTED',
    );
  });
test('network errors and upstream redirects never disclose or forward credentials', async () => {
  let options: RequestInit | undefined;
  const api = new BookStack(config, async (_url, init) => {
    options = init;
    throw new Error(`socket failed ${aliceKey.tokenSecret}`);
  });
  await assert.rejects(
    () => api.read(aliceKey, 'pages', 1),
    (e: AppError) => e.code === 'BOOKSTACK_NETWORK' && !e.message.includes(aliceKey.tokenSecret),
  );
  assert.equal(options?.redirect, 'error');
  assert(options?.signal);
});
test('HTML login responses, malformed JSON, oversized bodies and incompatible versions fail closed', async () => {
  const cases: [() => Response, string][] = [
    [
      () => new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } }),
      'BOOKSTACK_BAD_RESPONSE',
    ],
    [
      () => new Response('{', { headers: { 'content-type': 'application/json' } }),
      'BOOKSTACK_BAD_RESPONSE',
    ],
    [() => Response.json({ value: 'x'.repeat(2000) }), 'BOOKSTACK_BAD_RESPONSE'],
    [() => Response.json({ version: 'v99.01.0' }), 'BOOKSTACK_VERSION_MISMATCH'],
    [() => Response.json({}), 'BOOKSTACK_BAD_RESPONSE'],
  ];
  for (const [respond, code] of cases) {
    const api = new BookStack({ ...config, maxResponseBytes: 1024 }, async () => respond());
    await assert.rejects(
      () => api.validate(aliceKey),
      (e: AppError) => e.code === code,
    );
  }
});
test('a failed write is performed once; errors include correlation ID and safe logs', async () => {
  let calls = 0;
  const f = fixture(async () => {
    calls++;
    return Response.json({ secret: aliceKey.tokenSecret }, { status: 500 });
  });
  try {
    f.store.save(alice, aliceKey, 'v26.09.2');
    const r = await f.call('bookstack_update_page', { id: 1, name: 'Changed' }, await token());
    const line = r.text.startsWith('event:')
      ? r.text
          .split('\n')
          .find((x) => x.startsWith('data: '))!
          .slice(6)
      : r.text;
    const body = JSON.parse(line),
      result = JSON.parse(body.result.content[0].text);
    assert.equal(result.code, 'BOOKSTACK_UPSTREAM');
    assert.equal(result.correlationId, r.headers['x-correlation-id']);
    assert.equal(calls, 1);
    assert(!JSON.stringify(f.records).includes(aliceKey.tokenSecret));
    assert(!r.text.includes(aliceKey.tokenSecret));
  } finally {
    await f.close();
  }
});
test('real HTTP redirect is rejected and never sends a personal key to the redirect target', async () => {
  const { createServer } = await import('node:http');
  const { once } = await import('node:events');
  let forwarded = 0;
  const target = createServer((_req, res) => {
    forwarded++;
    res.end('{}');
  });
  const source = createServer((_req, res) => {
    res.writeHead(302, {
      location: `http://127.0.0.1:${(target.address() as import('node:net').AddressInfo).port}/steal`,
    });
    res.end();
  });
  target.listen(0, '127.0.0.1');
  await once(target, 'listening');
  source.listen(0, '127.0.0.1');
  await once(source, 'listening');
  try {
    const api = new BookStack({
      ...config,
      bookstackUrl: `http://127.0.0.1:${(source.address() as import('node:net').AddressInfo).port}`,
    });
    await assert.rejects(
      () => api.read(aliceKey, 'pages', 1),
      (e: AppError) => e.code === 'BOOKSTACK_NETWORK',
    );
    assert.equal(forwarded, 0);
  } finally {
    const stoppedSource = once(source, 'close'),
      stoppedTarget = once(target, 'close');
    source.close();
    source.closeAllConnections();
    target.close();
    target.closeAllConnections();
    await Promise.all([stoppedSource, stoppedTarget]);
  }
});

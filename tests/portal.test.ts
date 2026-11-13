import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, alice, bob, aliceKey, bobKey } from './helpers.js';

for (const path of [
  '/',
  '/guide',
  '/healthz',
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-protected-resource/mcp',
])
  test(`public ${path} exposes no personal data`, async () => {
    const f = fixture();
    try {
      f.store.save(alice, aliceKey, 'v26.09.2');
      const r = await f.http().get(path).set('Host', f.host);
      assert.equal(r.status, 200);
      assert(!r.text.includes(aliceKey.tokenId));
      assert(!r.text.includes('alice'));
    } finally {
      await f.close();
    }
  });
test('anonymous setup redirects to login; key mutations and logout require session', async () => {
  const f = fixture();
  try {
    const get = await f.http().get('/setup').set('Host', f.host);
    assert.equal(get.status, 302);
    assert.equal(get.headers.location, '/auth/login');
    for (const path of ['/setup/key', '/setup/key/delete', '/auth/logout']) {
      const r = await f.http().post(path).set('Host', f.host).type('form').send(aliceKey);
      assert.equal(r.status, 401);
    }
  } finally {
    await f.close();
  }
});
test('login uses secure cookies; setup does not render stored credentials', async () => {
  const f = fixture();
  try {
    f.store.save(alice, aliceKey, 'v26.09.2');
    const { setup, start, callback } = await f.login();
    assert.equal(callback.status, 302);
    assert.equal(setup.status, 200);
    assert(!setup.text.includes(aliceKey.tokenId));
    assert(!setup.text.includes(aliceKey.tokenSecret));
    assert.match(setup.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.equal(setup.headers['cache-control'], 'no-store');
    for (const cookie of [...start.headers['set-cookie'], ...callback.headers['set-cookie']]) {
      assert.match(cookie, /Secure/);
      assert.match(cookie, /HttpOnly/);
      assert.match(cookie, /SameSite=Lax/);
      assert(!/Domain=/.test(cookie));
    }
  } finally {
    await f.close();
  }
});
test('callback rejects absent browser binding, wrong state and replay', async () => {
  const f = fixture();
  try {
    const noCookie = await f.http().get('/auth/callback?code=fake&state=fake').set('Host', f.host);
    assert.equal(noCookie.status, 401);
    const start = await f.http().get('/auth/login').set('Host', f.host);
    const cookie = start.headers['set-cookie'][0].split(';')[0],
      state = new URL(start.headers.location).searchParams.get('state');
    const bad = await f
      .http()
      .get('/auth/callback?code=fake&state=wrong')
      .set('Host', f.host)
      .set('Cookie', cookie);
    assert.equal(bad.status, 401);
    const replay = await f
      .http()
      .get(`/auth/callback?code=fake&state=${state}`)
      .set('Host', f.host)
      .set('Cookie', cookie);
    assert.equal(replay.status, 401);
  } finally {
    await f.close();
  }
});
test('CSRF and same-origin checks protect save, delete, and logout', async () => {
  const f = fixture();
  try {
    const { session, csrf } = await f.login();
    for (const path of ['/setup/key', '/setup/key/delete', '/auth/logout']) {
      for (const [origin, input] of [
        [undefined, csrf],
        ['https://attacker.example.org', csrf],
        [undefined, 'bad'],
      ] as const) {
        let req = f.http().post(path).set('Host', f.host).set('Cookie', session).type('form');
        if (origin) req = req.set('Origin', origin);
        const r = await req.send({ csrf: input, ...aliceKey, personal: 'yes' });
        assert.equal(r.status, 403);
      }
    }
    assert.equal(f.store.status(alice).connected, false);
  } finally {
    await f.close();
  }
});
test('secure form validates before saving and replaces/removes only own credential', async () => {
  const calls: string[] = [];
  const f = fixture(async (url, init) => {
    calls.push(`${init?.method} ${new URL(String(url)).pathname}`);
    return Response.json({ version: 'v26.09.2' });
  });
  try {
    f.store.save(bob, bobKey, 'v26.09.2');
    const { session, csrf } = await f.login();
    const post = (path: string, values: unknown) =>
      f
        .http()
        .post(path)
        .set('Host', f.host)
        .set('Origin', 'https://bookstack-mcp.example.org')
        .set('Cookie', session)
        .type('form')
        .send(values);
    assert.equal((await post('/setup/key', { csrf, ...aliceKey, personal: 'yes' })).status, 303);
    assert.deepEqual(f.store.get(alice), aliceKey);
    assert.deepEqual(calls, ['GET /api/system']);
    assert.equal((await post('/setup/key', { csrf, ...bobKey, personal: 'yes' })).status, 303);
    assert.deepEqual(f.store.get(alice), bobKey);
    assert.equal((await post('/setup/key/delete', { csrf, userId: 'bob' })).status, 303);
    assert.throws(() => f.store.get(alice));
    assert.deepEqual(f.store.get(bob), bobKey);
    assert.equal((await post('/auth/logout', { csrf })).status, 303);
    assert.equal(
      (await f.http().get('/setup').set('Host', f.host).set('Cookie', session)).status,
      302,
    );
    const logs = JSON.stringify(f.records);
    assert(!logs.includes(aliceKey.tokenSecret));
    assert(!logs.includes(bobKey.tokenSecret));
  } finally {
    await f.close();
  }
});
test('invalid or rejected key never overwrites existing working credential or appears in HTML', async () => {
  const f = fixture(async () =>
    Response.json({ error: { message: aliceKey.tokenSecret } }, { status: 401 }),
  );
  try {
    f.store.save(alice, bobKey, 'v26.09.2');
    const { session, csrf } = await f.login();
    const post = (values: unknown) =>
      f
        .http()
        .post('/setup/key')
        .set('Host', f.host)
        .set('Origin', 'https://bookstack-mcp.example.org')
        .set('Cookie', session)
        .type('form')
        .send(values);
    assert.equal((await post({ csrf, ...aliceKey })).status, 400);
    assert.equal(
      (await post({ csrf, tokenId: 'bad\r\ninjection', tokenSecret: 'bad', personal: 'yes' }))
        .status,
      400,
    );
    const rejected = await post({ csrf, ...aliceKey, personal: 'yes' });
    assert.equal(rejected.status, 424);
    assert(!rejected.text.includes(aliceKey.tokenSecret));
    assert.deepEqual(f.store.get(alice), bobKey);
  } finally {
    await f.close();
  }
});
test('host and browser Origin are exact boundaries; forwarded host cannot override them', async () => {
  const f = fixture();
  try {
    assert.equal(
      (
        await f
          .http()
          .get('/healthz')
          .set('Host', 'attacker.example.org')
          .set('X-Forwarded-Host', f.host)
      ).status,
      403,
    );
    assert.equal(
      (
        await f
          .http()
          .post('/mcp')
          .set('Host', f.host)
          .set('Origin', 'https://attacker.example.org')
          .send({})
      ).status,
      403,
    );
    assert.equal((await f.http().post('/mcp').set('Host', f.host).send({})).status, 401);
  } finally {
    await f.close();
  }
});

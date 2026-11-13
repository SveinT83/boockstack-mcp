import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../src/vault.js';
import { Store, identityKey } from '../src/store.js';
import { alice, bob, aliceKey, bobKey, keyring } from './helpers.js';

test('AES-GCM binds ciphertext to identity and detects tampering', () => {
  const vault = new Vault(keyring),
    context = `bookstack:${identityKey(alice)}`;
  const encrypted = vault.seal(aliceKey, context);
  assert(!encrypted.includes(aliceKey.tokenSecret));
  assert.deepEqual(vault.open(encrypted, context), aliceKey);
  assert.throws(() => vault.open(encrypted, `bookstack:${identityKey(bob)}`));
  const tampered = JSON.parse(encrypted);
  tampered.data = Buffer.from('tampered').toString('base64');
  assert.throws(() => vault.open(JSON.stringify(tampered), context));
  assert.notEqual(encrypted, vault.seal(aliceKey, context));
});
test('reject absent or malformed master keys', () => {
  assert.throws(() => new Vault({ activeKeyId: 'missing', keys: {} }));
  assert.throws(() => new Vault({ activeKeyId: 'k', keys: { k: 'bad' } }));
});
test('users and issuers remain isolated for get, replace and delete', () => {
  const store = new Store(':memory:', new Vault(keyring));
  try {
    store.save(alice, aliceKey, 'v26.09.2');
    assert.throws(() => store.get(bob));
    store.save(bob, bobKey, 'v26.09.2');
    assert.deepEqual(store.get(alice), aliceKey);
    assert.deepEqual(store.get(bob), bobKey);
    assert.throws(() => store.get({ ...alice, issuer: 'https://other.example.org' }));
    store.save(alice, bobKey, 'v26.09.2');
    store.remove(alice);
    assert.throws(() => store.get(alice));
    assert.deepEqual(store.get(bob), bobKey);
  } finally {
    store.close();
  }
});
test('database and WAL contain no plaintext credentials; restore requires separate keyring', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bookstack-test-'));
  const path = join(dir, 'vault.sqlite');
  const store = new Store(path, new Vault(keyring));
  try {
    store.save(alice, aliceKey, 'v26.09.2');
    for (const file of [path, `${path}-wal`]) {
      const bytes = readFileSync(file);
      assert(!bytes.includes(Buffer.from(aliceKey.tokenSecret)));
      assert(!bytes.includes(Buffer.from(aliceKey.tokenId)));
    }
    assert.equal(statSync(path).mode & 0o777, 0o600);
  } finally {
    store.close();
  }
  const reopened = new Store(path, new Vault(keyring));
  try {
    assert.deepEqual(reopened.get(alice), aliceKey);
  } finally {
    reopened.close();
  }
  const wrong = new Store(
    path,
    new Vault({ activeKeyId: 'k1', keys: { k1: randomBytes(32).toString('base64') } }),
  );
  try {
    assert.throws(() => wrong.get(alice));
  } finally {
    wrong.close();
    rmSync(dir, { recursive: true });
  }
});
test('rotation rewrites all credentials under new key and clears sessions', () => {
  const store = new Store(
    ':memory:',
    new Vault({
      activeKeyId: 'k2',
      keys: { ...keyring.keys, k2: randomBytes(32).toString('base64') },
    }),
  );
  const oldVault = new Vault(keyring),
    oldCipher = oldVault.seal(aliceKey, `bookstack:${identityKey(alice)}`);
  try {
    store.db
      .prepare('INSERT INTO credentials VALUES (?, ?, ?, ?)')
      .run(identityKey(alice), oldCipher, 'now', 'v26.09.2');
    store.createSession('session', alice, 'csrf');
    assert.equal(store.rotate(), 1);
    const row = store.db.prepare('SELECT encrypted FROM credentials').get() as {
      encrypted: string;
    };
    assert.equal(JSON.parse(row.encrypted).kid, 'k2');
    assert.deepEqual(store.get(alice), aliceKey);
    assert.equal(store.session('session'), undefined);
  } finally {
    store.close();
  }
});
test('opaque sessions are hashed, encrypted, expire, and logout invalidates', () => {
  const store = new Store(':memory:', new Vault(keyring));
  try {
    store.createSession('session-plain', alice, 'csrf-plain');
    const dump = JSON.stringify(store.db.prepare('SELECT * FROM sessions').all());
    assert(!dump.includes('session-plain'));
    assert(!dump.includes('csrf-plain'));
    assert.equal(store.session('session-plain')?.principal.subject, 'alice');
    store.deleteSession('session-plain');
    assert.equal(store.session('session-plain'), undefined);
    store.createSession('expired', { ...alice, expiresAt: 1 }, 'csrf');
    assert.equal(store.session('expired'), undefined);
  } finally {
    store.close();
  }
});

import Database from 'better-sqlite3';
import { chmodSync, lstatSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { Vault } from './vault.js';
import type { Principal } from './auth.js';
import { AppError } from './errors.js';

export interface Credentials {
  tokenId: string;
  tokenSecret: string;
}
export const identityKey = (p: Pick<Principal, 'issuer' | 'subject'>): string =>
  JSON.stringify([p.issuer, p.subject]);
export const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
export class Store {
  readonly db: Database.Database;
  constructor(
    path: string,
    private vault: Vault,
  ) {
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      try {
        if (!lstatSync(path).isFile())
          throw new Error('Database må være en vanlig fil uten symlenke.');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
    this.db = new Database(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('secure_delete = ON');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(`CREATE TABLE IF NOT EXISTS credentials (
      identity TEXT PRIMARY KEY, encrypted TEXT NOT NULL, updated_at TEXT NOT NULL, version TEXT NOT NULL
    ); CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, encrypted TEXT NOT NULL, expires INTEGER NOT NULL
    );`);
  }
  save(p: Principal, credentials: Credentials, version: string): void {
    const key = identityKey(p);
    const encrypted = this.vault.seal(credentials, `bookstack:${key}`);
    this.db
      .prepare(
        'INSERT INTO credentials VALUES (?, ?, ?, ?) ON CONFLICT(identity) DO UPDATE SET encrypted=excluded.encrypted, updated_at=excluded.updated_at, version=excluded.version',
      )
      .run(key, encrypted, new Date().toISOString(), version);
  }
  get(p: Principal): Credentials {
    const key = identityKey(p);
    const row = this.db.prepare('SELECT encrypted FROM credentials WHERE identity = ?').get(key) as
      { encrypted: string } | undefined;
    if (!row)
      throw new AppError(
        'BOOKSTACK_KEY_MISSING',
        'Du mangler personlig BookStack API-nøkkel. Åpne oppsettsiden og logg inn.',
        409,
      );
    return this.vault.open<Credentials>(row.encrypted, `bookstack:${key}`);
  }
  status(p: Principal): {
    connected: boolean;
    updatedAt?: string;
    checkedVersion?: string;
    ownerVerified: false;
  } {
    const row = this.db
      .prepare('SELECT updated_at, version FROM credentials WHERE identity = ?')
      .get(identityKey(p)) as { updated_at: string; version: string } | undefined;
    return row
      ? {
          connected: true,
          updatedAt: row.updated_at,
          checkedVersion: row.version,
          ownerVerified: false,
        }
      : { connected: false, ownerVerified: false };
  }
  remove(p: Principal): void {
    this.db.prepare('DELETE FROM credentials WHERE identity = ?').run(identityKey(p));
  }
  createSession(id: string, principal: Principal, csrf: string): void {
    this.db.prepare('DELETE FROM sessions WHERE expires <= ?').run(Date.now());
    const key = hash(id);
    this.db
      .prepare('INSERT INTO sessions VALUES (?, ?, ?)')
      .run(
        key,
        this.vault.seal({ principal, csrf }, `session:${key}`),
        Math.min(principal.expiresAt * 1000, Date.now() + 15 * 60_000),
      );
  }
  session(id: string): { principal: Principal; csrf: string } | undefined {
    const key = hash(id);
    const row = this.db
      .prepare('SELECT encrypted FROM sessions WHERE id = ? AND expires > ?')
      .get(key, Date.now()) as { encrypted: string } | undefined;
    return row ? this.vault.open(row.encrypted, `session:${key}`) : undefined;
  }
  deleteSession(id: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(hash(id));
  }
  rotate(): number {
    const count = this.db.transaction(() => {
      const rows = this.db.prepare('SELECT identity, encrypted FROM credentials').all() as {
        identity: string;
        encrypted: string;
      }[];
      for (const row of rows) {
        const context = `bookstack:${row.identity}`;
        this.db
          .prepare('UPDATE credentials SET encrypted = ? WHERE identity = ?')
          .run(this.vault.seal(this.vault.open(row.encrypted, context), context), row.identity);
      }
      this.db.prepare('DELETE FROM sessions').run();
      return rows.length;
    })();
    this.db.pragma('wal_checkpoint(TRUNCATE)');
    return count;
  }
  close(): void {
    this.db.close();
  }
}

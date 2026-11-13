import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadConfig } from './config.js';
import { Vault } from './vault.js';
import { Store } from './store.js';
import { createIdentityProvider } from './auth.js';
import { createApp } from './app.js';
import { logJson } from './errors.js';

process.umask(0o077);
let stage = 'config';
try {
  const config = loadConfig();
  stage = 'keyring';
  const vault = Vault.fromFile(config.keyringFile);
  stage = 'database';
  mkdirSync(dirname(config.databasePath), { recursive: true, mode: 0o700 });
  const store = new Store(config.databasePath, vault);
  stage = 'oidc';
  const idp = await createIdentityProvider(config);
  const { app, close } = createApp(config, store, idp);
  const server = app.listen(config.port, config.host, () =>
    logJson({ event: 'started', host: config.host, port: config.port }),
  );
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    const timer = setTimeout(() => process.exit(1), 10_000).unref();
    server.close(() => {
      void close().finally(() => {
        store.close();
        clearTimeout(timer);
      });
    });
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  server.on('error', () => {
    logJson({ event: 'listen_failed', code: 'MCP_STARTUP' });
    process.exit(1);
  });
} catch {
  // Dependency errors may contain credentials or HTTP bodies: never dump them.
  logJson({
    event: 'startup_failed',
    code: 'MCP_STARTUP',
    stage,
    message:
      'Kontroller JSON-konfigurasjon, hemmelighetsfilenes modus, SQLite-tilgang og Keycloak discovery/S256. Se README.',
  });
  process.exitCode = 1;
}

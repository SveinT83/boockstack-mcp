import { loadConfig } from './config.js';
import { Store } from './store.js';
import { Vault } from './vault.js';
process.umask(0o077);
try {
  const config = loadConfig();
  const store = new Store(config.databasePath, Vault.fromFile(config.keyringFile));
  try {
    console.log(JSON.stringify({ rotatedCredentials: store.rotate(), sessionsCleared: true }));
  } finally {
    store.close();
  }
} catch {
  console.error(
    'Nøkkelrotasjon feilet. Behold alle gamle nøkler og kontroller konfigurasjon/backup.',
  );
  process.exitCode = 1;
}

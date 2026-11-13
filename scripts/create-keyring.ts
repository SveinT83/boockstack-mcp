import { writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { randomBytes } from 'node:crypto';
const path = process.argv[2];
if (!path || !isAbsolute(path)) {
  console.error('Bruk: npx tsx scripts/create-keyring.ts /absolutt/beskyttet/sti/keyring.json');
  process.exit(1);
}
try {
  writeFileSync(
    path,
    JSON.stringify(
      { activeKeyId: 'key-1', keys: { 'key-1': randomBytes(32).toString('base64') } },
      null,
      2,
    ) + '\n',
    { mode: 0o600, flag: 'wx' },
  );
  console.log('Opprettet keyring med modus 0600. Verdien skrives ikke til terminalen.');
} catch {
  console.error(
    'Kunne ikke opprette keyring. Filen må ikke finnes fra før, og mappen må være beskyttet og skrivbar.',
  );
  process.exitCode = 1;
}

import { loadConfig, readPrivateFile } from '../src/config.js';
import { BookStack, credentialsSchema } from '../src/bookstack.js';
import { publicError } from '../src/errors.js';

try {
  const config = loadConfig();
  const headers = { Accept: 'text/html' };
  const login = await fetch(`${config.bookstackUrl}/login`, {
    redirect: 'error',
    headers,
    signal: AbortSignal.timeout(config.upstreamTimeoutMs),
  });
  const html = (await login.text()).slice(0, 1_000_000);
  const versions = [
    ...new Set([...html.matchAll(/[?&]version=(v\d+\.\d+\.\d+)/g)].map((m) => m[1])),
  ];
  console.log(
    JSON.stringify({
      check: 'public_login_assets',
      status: login.status,
      assetVersions: versions,
      note: 'Assetversjon er offentlig indikasjon; autentisert /api/system gir API-bekreftelse.',
    }),
  );
  const docs = await fetch(`${config.bookstackUrl}/api/docs`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(config.upstreamTimeoutMs),
  });
  console.log(
    JSON.stringify({
      check: 'api_docs',
      status: docs.status,
      requiresLogin: docs.status === 302 && docs.headers.get('location')?.endsWith('/login'),
    }),
  );
  await docs.body?.cancel();
  const index = process.argv.indexOf('--credential-file');
  if (index !== -1) {
    const path = process.argv[index + 1];
    if (!path) throw new Error('Missing file');
    const credentials = credentialsSchema.parse(JSON.parse(readPrivateFile(path)));
    const api = new BookStack(config);
    const version = await api.validate(credentials);
    await api.list(credentials, 'books', 0, 1);
    console.log(
      JSON.stringify({
        check: 'authenticated_read',
        version,
        systemRead: true,
        booksRead: true,
        writes: false,
      }),
    );
  } else {
    console.log(
      JSON.stringify({
        check: 'authenticated_read',
        status: 'not_tested',
        reason: 'Ingen personlig credential-fil oppgitt. Ingen skrivekall er utført.',
      }),
    );
  }
} catch (error) {
  console.error(JSON.stringify({ check: 'failed', code: publicError(error).code }));
  process.exitCode = 1;
}

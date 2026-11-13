import { Config } from './config.js';
import { AppError } from './errors.js';
import { Credentials } from './store.js';
import { z } from 'zod';

export const credentialsSchema = z
  .object({
    tokenId: z.string().regex(/^[a-zA-Z0-9]{10,255}$/),
    tokenSecret: z.string().regex(/^[a-zA-Z0-9]{10,255}$/),
  })
  .strict();
export type Entity = 'shelves' | 'books' | 'chapters' | 'pages';
async function readJson(response: Response, limit: number): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No body');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error('Response too large');
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
// BookStack v26.09.2 has no machine-readable auth error code beyond HTTP status.
// These exact upstream translations distinguish expired tokens (also HTTP 403).
const expiredMessages = new Set([
  'The authorization token used has expired',
  'Autorisasjonstokenet som er brukt, har utløpt',
]);
export class BookStack {
  constructor(
    private config: Config,
    private fetcher: typeof fetch = fetch,
  ) {}
  private async request(
    credentials: Credentials,
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    query?: Record<string, string | number>,
    body?: unknown,
  ): Promise<unknown> {
    // Only internal, finite paths reach here; never accept a URL from an MCP argument.
    if (!/^\/(system|search|shelves|books|chapters|pages)(\/\d+)?$/.test(path))
      throw new Error('Invalid internal API path');
    credentialsSchema.parse(credentials);
    const url = new URL(`${this.config.bookstackUrl}/api${path}`);
    for (const [key, value] of Object.entries(query ?? {}))
      url.searchParams.set(key, String(value));
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(this.config.upstreamTimeoutMs),
        headers: {
          Authorization: `Token ${credentials.tokenId}:${credentials.tokenSecret}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new AppError(
        'BOOKSTACK_NETWORK',
        'Fikk ikke kontakt med BookStack, eller forespørselen tok for lang tid. Et skrivekall kan ha blitt utført; kontroller før du prøver igjen.',
        502,
      );
    }
    if (!response.ok) {
      const status = response.status;
      if (status === 403 && response.headers.get('content-type')?.includes('application/json')) {
        const data = (await readJson(response, 65536).catch(() => null)) as {
          error?: { message?: string };
        } | null;
        if (expiredMessages.has(data?.error?.message ?? ''))
          throw new AppError(
            'BOOKSTACK_KEY_REJECTED',
            'BookStack-nøkkelen har utløpt. Erstatt den på oppsettsiden.',
            424,
            status,
          );
      } else await response.body?.cancel();
      if (status === 401)
        throw new AppError(
          'BOOKSTACK_KEY_REJECTED',
          'BookStack avviste API-nøkkelen. Den kan være utløpt eller tilbakekalt. Erstatt nøkkelen på oppsettsiden.',
          424,
          status,
        );
      if (status === 403)
        throw new AppError(
          'BOOKSTACK_PERMISSION_DENIED',
          'BookStack avviste tilgangen. Kontroller «Access System API» og rettigheter til innholdet. Ved annet BookStack-språk må også nøkkelens utløpsdato kontrolleres.',
          403,
          status,
        );
      if (status === 404)
        throw new AppError(
          'BOOKSTACK_NOT_FOUND',
          'Innholdet finnes ikke eller er skjult av BookStack-rettigheter.',
          404,
          status,
        );
      if (status === 422 || status === 400)
        throw new AppError(
          'BOOKSTACK_VALIDATION',
          'BookStack avviste innholdet. Kontroller påkrevde felt og gyldig plassering.',
          422,
          status,
        );
      if (status === 429)
        throw new AppError(
          'BOOKSTACK_RATE_LIMIT',
          'BookStack har midlertidig begrenset antall forespørsler. Vent før du prøver igjen.',
          429,
          status,
        );
      throw new AppError(
        'BOOKSTACK_UPSTREAM',
        'BookStack svarte med en feil. Ved skrivekall må utfallet kontrolleres før nytt forsøk.',
        502,
        status,
      );
    }
    if (!response.headers.get('content-type')?.includes('application/json')) {
      await response.body?.cancel();
      throw new AppError(
        'BOOKSTACK_BAD_RESPONSE',
        'BookStack svarte ikke med forventet JSON-format.',
        502,
      );
    }
    try {
      return await readJson(response, this.config.maxResponseBytes);
    } catch {
      throw new AppError(
        'BOOKSTACK_BAD_RESPONSE',
        'BookStack-svaret var ugyldig eller for stort. Begrens søket eller les mindre innhold. Ved skrivekall må utfallet kontrolleres.',
        502,
      );
    }
  }
  async validate(credentials: Credentials): Promise<string> {
    const data = (await this.request(credentials, 'GET', '/system')) as { version?: unknown };
    if (typeof data?.version !== 'string')
      throw new AppError('BOOKSTACK_BAD_RESPONSE', 'BookStack oppga ikke systemversjon.', 502);
    if (data.version.replace(/^v/, '') !== this.config.expectedBookstackVersion.replace(/^v/, '')) {
      throw new AppError(
        'BOOKSTACK_VERSION_MISMATCH',
        'BookStack-versjonen er endret. Drift må kontrollere API-kompatibilitet før nøkkelen lagres.',
        409,
      );
    }
    return data.version;
  }
  search(c: Credentials, query: string, page: number, count: number): Promise<unknown> {
    return this.request(c, 'GET', '/search', { query, page, count });
  }
  list(c: Credentials, kind: Entity, offset: number, count: number): Promise<unknown> {
    return this.request(c, 'GET', `/${kind}`, { offset, count, sort: '+id' });
  }
  read(c: Credentials, kind: Entity, id: number): Promise<unknown> {
    return this.request(c, 'GET', `/${kind}/${id}`);
  }
  create(c: Credentials, kind: Exclude<Entity, 'shelves'>, body: unknown): Promise<unknown> {
    return this.request(c, 'POST', `/${kind}`, undefined, body);
  }
  update(
    c: Credentials,
    kind: Exclude<Entity, 'shelves'>,
    id: number,
    body: unknown,
  ): Promise<unknown> {
    return this.request(c, 'PUT', `/${kind}/${id}`, undefined, body);
  }
}

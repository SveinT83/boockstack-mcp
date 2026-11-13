import express, { type ErrorRequestHandler, type Request, type Response } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { Config, READ_SCOPE, WRITE_SCOPE, resource } from './config.js';
import { IdentityProvider, LoginAttempt, Principal } from './auth.js';
import { Store, hash } from './store.js';
import { BookStack, credentialsSchema } from './bookstack.js';
import { AppError, Log, logJson, publicError } from './errors.js';
import { createServer, WRITE_TOOLS } from './tools.js';
import { escapeHtml as esc, page, stylesheet } from './html.js';

const random = (): string => randomBytes(32).toString('base64url');
function same(a: unknown, b: string): boolean {
  if (typeof a !== 'string') return false;
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
interface Flow extends LoginAttempt {
  expires: number;
}
export function createApp(
  config: Config,
  store: Store,
  idp: IdentityProvider,
  bookstack = new BookStack(config),
  log: Log = logJson,
) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustedProxies.length ? config.trustedProxies : false);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          styleSrc: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          ...(config.publicOrigin.startsWith('http:') ? { upgradeInsecureRequests: null } : {}),
        },
      },
      // no-referrer makes native HTML form POSTs send Origin: null, failing CSRF.
      // strict-origin preserves their HTTPS Origin without revealing paths or queries.
      referrerPolicy: { policy: 'strict-origin' },
    }),
  );
  app.use((req, res, next) => {
    res.locals.correlationId = randomUUID();
    res.set('X-Correlation-ID', res.locals.correlationId);
    res.set('Cache-Control', 'no-store');
    const started = Date.now();
    res.on('finish', () =>
      log({
        event: 'http',
        correlationId: res.locals.correlationId,
        method: req.method,
        route: req.route?.path ?? 'unmatched',
        status: res.statusCode,
        durationMs: Date.now() - started,
      }),
    );
    // Do not derive public callback URLs or trust boundaries from forwarded headers.
    if (req.headers.host !== new URL(config.publicOrigin).host)
      return next(new AppError('HOST_REJECTED', 'Ugyldig vertsnavn.', 403));
    next();
  });
  app.use(cookieParser());
  const secure = config.publicOrigin.startsWith('https:');
  const sessionCookie = secure ? '__Host-bookstack_session' : 'bookstack_local_session';
  const flowCookie = secure ? '__Host-bookstack_login' : 'bookstack_local_login';
  const cookieOptions = { secure, httpOnly: true, sameSite: 'lax' as const, path: '/' };
  const flows = new Map<string, Flow>();
  const requestCorrelation = new AsyncLocalStorage<string>();
  const loginLimit = rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) =>
      next(
        new AppError('RATE_LIMIT', 'For mange innloggingsforsøk. Vent litt og prøv igjen.', 429),
      ),
  });
  const mcpLimit = rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) =>
      next(new AppError('RATE_LIMIT', 'For mange forespørsler. Vent litt og prøv igjen.', 429)),
  });
  const formLimit = rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) =>
      next(new AppError('RATE_LIMIT', 'For mange nøkkelendringer. Vent litt og prøv igjen.', 429)),
  });
  const metadata = {
    resource: resource(config),
    authorization_servers: [config.issuer],
    scopes_supported: [READ_SCOPE, WRITE_SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'Trønder Data BookStack',
    resource_documentation: `${config.publicOrigin}/guide`,
  };
  app.get(
    ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource'],
    (_req, res) => res.json(metadata),
  );
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  app.get('/style.css', (_req, res) => res.type('css').send(stylesheet));
  app.get('/', (_req, res) =>
    res
      .type('html')
      .send(
        page(
          'Din personlige BookStack-tilkobling',
          `<p>Logg inn med jobbkontoen for å koble din personlige BookStack API-nøkkel til MCP-en.</p><a class="button" href="/setup">Logg inn og administrer nøkkel</a><p><a href="/guide">Les veiledningen</a></p><p>Legg aldri Token ID eller Token Secret i ChatGPT.</p>`,
        ),
      ),
  );
  app.get('/guide', (_req, res) => res.type('html').send(page('Kom i gang', guide(config))));
  app.get('/auth/login', loginLimit, async (req, res) => {
    const now = Date.now();
    for (const [key, flow] of flows) if (flow.expires < now) flows.delete(key);
    if (flows.size >= 1000)
      throw new AppError('LOGIN_BUSY', 'Innloggingstjenesten er opptatt. Prøv igjen senere.', 503);
    const previous = req.cookies?.[flowCookie];
    if (typeof previous === 'string') flows.delete(hash(previous));
    const handle = random();
    const attempt = {
      state: random(),
      nonce: random(),
      verifier: random(),
      expires: now + 5 * 60_000,
    };
    const location = await idp.login(attempt);
    flows.set(hash(handle), attempt);
    res.cookie(flowCookie, handle, { ...cookieOptions, maxAge: 5 * 60_000 });
    res.redirect(location);
  });
  app.get('/auth/callback', loginLimit, async (req, res) => {
    res.set('Referrer-Policy', 'no-referrer');
    const handle = req.cookies?.[flowCookie];
    const attempt = typeof handle === 'string' ? flows.get(hash(handle)) : undefined;
    if (typeof handle === 'string') flows.delete(hash(handle));
    res.clearCookie(flowCookie, cookieOptions);
    if (!attempt || attempt.expires <= Date.now() || !same(req.query.state, attempt.state))
      throw new AppError(
        'MCP_LOGIN_FAILED',
        'Innloggingen er utløpt eller kan ikke bekreftes. Start på nytt.',
        401,
      );
    const principal = await idp.callback(new URL(req.originalUrl, config.publicOrigin), attempt);
    const session = random();
    store.createSession(session, principal, random());
    res.cookie(sessionCookie, session, {
      ...cookieOptions,
      maxAge: Math.max(0, Math.min(15 * 60_000, principal.expiresAt * 1000 - Date.now())),
    });
    res.redirect('/setup');
  });
  function requireSession(req: Request, res: Response, next: express.NextFunction): void {
    const id = req.cookies?.[sessionCookie];
    const session = typeof id === 'string' ? store.session(id) : undefined;
    if (!session) {
      if (req.method === 'GET') {
        res.redirect('/auth/login');
        return;
      }
      next(
        new AppError(
          'MCP_LOGIN_REQUIRED',
          'Webinnloggingen mangler eller har utløpt. Logg inn på nytt.',
          401,
        ),
      );
      return;
    }
    res.locals.session = session;
    res.locals.sessionId = id;
    next();
  }
  function csrf(req: Request, res: Response, next: express.NextFunction): void {
    if (
      req.headers.origin !== config.publicOrigin ||
      !same(req.body?.csrf, res.locals.session.csrf)
    ) {
      next(
        new AppError(
          'CSRF_REJECTED',
          'Skjemaet kunne ikke bekreftes. Åpne oppsettsiden på nytt.',
          403,
        ),
      );
      return;
    }
    next();
  }
  app.get('/setup', requireSession, (_req, res) => {
    const session = res.locals.session as { principal: Principal; csrf: string };
    const status = store.status(session.principal);
    const csrfInput = `<input type="hidden" name="csrf" value="${esc(session.csrf)}">`;
    res
      .type('html')
      .send(
        page(
          'Min BookStack-nøkkel',
          `<p class="notice">${status.connected ? 'Du har en lagret nøkkel. Den vises aldri her.' : 'Du har ikke lagret en personlig nøkkel ennå.'}</p>${guide(config)}<hr><h2>${status.connected ? 'Erstatt nøkkel' : 'Koble til nøkkel'}</h2><form method="post" action="/setup/key" autocomplete="off">${csrfInput}<label for="tokenId">Token ID</label><input id="tokenId" name="tokenId" type="password" required maxlength="255" autocomplete="off" spellcheck="false"><label for="tokenSecret">Token Secret</label><input id="tokenSecret" name="tokenSecret" type="password" required maxlength="255" autocomplete="new-password" spellcheck="false"><label><input type="checkbox" name="personal" value="yes" required> Jeg bekrefter at dette er min egen personlige BookStack-nøkkel.</label><small>Nøkkelen testes med et lesekall før den lagres kryptert. Token Secret sendes aldri til ChatGPT.</small><button type="submit">Test og lagre nøkkel</button></form>${status.connected ? `<hr><form method="post" action="/setup/key/delete">${csrfInput}<p>Fjern den lagrede kopien fra MCP-en. Selve tokenet i BookStack blir fortsatt gyldig.</p><button class="danger" type="submit">Fjern min lagrede nøkkel</button></form>` : ''}<hr><form method="post" action="/auth/logout">${csrfInput}<button type="submit">Logg ut av denne nettsiden</button></form>`,
        ),
      );
  });
  const form = express.urlencoded({ extended: false, limit: '4kb', parameterLimit: 10 });
  app.post('/setup/key', formLimit, requireSession, form, csrf, async (req, res) => {
    if (req.body.personal !== 'yes')
      throw new AppError('PERSONAL_CONFIRMATION_REQUIRED', 'Bekreft at nøkkelen er din egen.', 400);
    const parsed = credentialsSchema.safeParse({
      tokenId: req.body.tokenId,
      tokenSecret: req.body.tokenSecret,
    });
    if (!parsed.success)
      throw new AppError(
        'BOOKSTACK_KEY_FORMAT',
        'Token ID og Token Secret har ugyldig format. Kopier begge fra BookStack.',
        400,
      );
    const version = await bookstack.validate(parsed.data);
    store.save(res.locals.session.principal, parsed.data, version);
    log({ event: 'credential_saved', correlationId: res.locals.correlationId });
    res.redirect(303, '/setup');
  });
  app.post('/setup/key/delete', formLimit, requireSession, form, csrf, (_req, res) => {
    store.remove(res.locals.session.principal);
    log({ event: 'credential_removed', correlationId: res.locals.correlationId });
    res.redirect(303, '/setup');
  });
  app.post('/auth/logout', requireSession, form, csrf, (_req, res) => {
    store.deleteSession(res.locals.sessionId);
    res.clearCookie(sessionCookie, cookieOptions);
    res.redirect(303, '/');
  });
  const handler = createMcpHandler(
    (ctx) => {
      const extra = ctx.authInfo?.extra;
      if (!extra?.principal || typeof extra.correlationId !== 'string')
        throw new Error('Missing validated principal');
      return createServer(
        config,
        store,
        bookstack,
        extra.principal as Principal,
        extra.correlationId,
        log,
      );
    },
    {
      legacy: 'stateless',
      maxRequestBodySize: 600_000,
      onerror: () =>
        log({
          event: 'mcp_protocol_error',
          code: 'MCP_PROTOCOL',
          correlationId: requestCorrelation.getStore(),
        }),
    },
  );
  const nodeHandler = toNodeHandler(handler, {
    maxRequestBodySize: 600_000,
    onerror: () =>
      log({
        event: 'mcp_adapter_error',
        code: 'MCP_INTERNAL',
        correlationId: requestCorrelation.getStore(),
      }),
  });
  app.all(
    '/mcp',
    mcpLimit,
    async (req, res, next) => {
      const origin = req.headers.origin;
      if (
        origin !== undefined &&
        ![config.publicOrigin, ...config.allowedMcpOrigins].includes(origin)
      )
        throw new AppError('ORIGIN_REJECTED', 'Origin er ikke tillatt.', 403);
      const authorization = req.headers.authorization;
      if (
        !authorization ||
        !/^Bearer [A-Za-z0-9._~-]+$/.test(authorization) ||
        authorization.length > 16384
      )
        throw new AppError(
          'MCP_LOGIN_REQUIRED',
          'Innlogging til MCP mangler eller er ugyldig. Koble til på nytt.',
          401,
        );
      res.locals.principal = await idp.verify(authorization.slice(7));
      next();
    },
    express.json({ limit: 600_000 }),
    async (req, res) => {
      const principal = res.locals.principal as Principal;
      if (
        req.body?.method === 'tools/call' &&
        WRITE_TOOLS.has(req.body?.params?.name) &&
        !principal.scopes.includes(WRITE_SCOPE)
      )
        throw new AppError(
          'MCP_WRITE_SCOPE_REQUIRED',
          'Innloggingen mangler scope for skriving i BookStack.',
          403,
        );
      // Pass validated claims, never a caller-supplied identity or upstream API key.
      Object.assign(req, {
        auth: {
          token: 'validated',
          clientId: 'keycloak',
          scopes: principal.scopes,
          expiresAt: principal.expiresAt,
          extra: { principal, correlationId: res.locals.correlationId },
        },
      });
      await requestCorrelation.run(res.locals.correlationId, () => nodeHandler(req, res, req.body));
    },
  );
  app.use((_req, _res, next) => next(new AppError('NOT_FOUND', 'Adressen finnes ikke.', 404)));
  const errors: ErrorRequestHandler = (error, req, res, _next) => {
    let failure = publicError(error);
    if (error?.type === 'entity.too.large')
      failure = new AppError('REQUEST_TOO_LARGE', 'Forespørselen er for stor.', 413);
    if (error?.type === 'entity.parse.failed')
      failure = new AppError('INVALID_JSON', 'Forespørselen inneholder ugyldig JSON.', 400);
    const correlationId = res.locals.correlationId;
    log({
      event: 'error',
      code: failure.code,
      correlationId,
      upstreamStatus: failure.upstreamStatus,
    });
    if (res.headersSent) {
      res.end();
      return;
    }
    if (
      req.path === '/mcp' &&
      (failure.status === 401 || (failure.code.startsWith('MCP_') && failure.status === 403))
    ) {
      const scopes =
        failure.code === 'MCP_WRITE_SCOPE_REQUIRED' ? `${READ_SCOPE} ${WRITE_SCOPE}` : READ_SCOPE;
      res.set(
        'WWW-Authenticate',
        `Bearer resource_metadata="${config.publicOrigin}/.well-known/oauth-protected-resource/mcp", scope="${scopes}", error="${failure.status === 403 ? 'insufficient_scope' : 'invalid_token'}"`,
      );
    }
    if (req.path.startsWith('/setup') || req.path.startsWith('/auth')) {
      res
        .status(failure.status)
        .type('html')
        .send(
          page(
            'Handlingen kunne ikke fullføres',
            `<p>${esc(failure.message)}</p><p>Korrelasjons-ID: <code>${esc(correlationId)}</code></p><p><a href="/setup">Tilbake til oppsett</a></p>`,
          ),
        );
    } else
      res
        .status(failure.status)
        .json({ code: failure.code, message: failure.message, correlationId });
  };
  app.use(errors);
  return { app, close: () => handler.close() };
}
function guide(config: Config): string {
  return `<ol><li>Åpne <a href="${esc(config.bookstackUrl)}" target="_blank" rel="noopener noreferrer">BookStack</a> og logg inn med din egen bruker.</li><li>Åpne din brukerprofil for redigering. Under «API Tokens» velger du «Create Token». Bruk et navn som «ChatGPT BookStack» og en passende utløpsdato.</li><li>Du trenger rettigheten «Access System API» på en av rollene dine. Kontakt BookStack-administrator hvis API Tokens mangler.</li><li>Kopier Token ID og Token Secret hit. Hemmeligheten vises normalt bare én gang. Oppbevar den i godkjent passordhvelv. Send den aldri i chat.</li></ol><p class="notice">BookStacks støttede API lar oss teste nøkkelen, men gir ikke et «hvem er jeg»-endepunkt som bekrefter eieren. Du må bruke din egen nøkkel. MCP-en kan ikke bevise at den tilhører samme person som jobbkontoen.</p><p><strong>Tre ulike handlinger:</strong> Å koble fra pluginen i ChatGPT stopper den forbindelsen. Å fjerne nøkkelen her sletter MCP-ens lagrede kopi. For å tilbakekalle selve API-tokenet må du slette det under API Tokens i BookStack. Utlogging her avslutter bare nettøkten.</p>`;
}

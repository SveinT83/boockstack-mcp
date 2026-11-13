import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import * as oidc from 'openid-client';
import { Config, READ_SCOPE, assertSafeUrl, readPrivateFile, resource } from './config.js';
import { AppError } from './errors.js';

export interface Principal {
  issuer: string;
  subject: string;
  scopes: string[];
  expiresAt: number;
}
export interface LoginAttempt {
  state: string;
  nonce: string;
  verifier: string;
}
export interface IdentityProvider {
  verify(token: string): Promise<Principal>;
  login(attempt: LoginAttempt): Promise<string>;
  callback(url: URL, attempt: LoginAttempt): Promise<Principal>;
}
export class TokenVerifier {
  constructor(
    private config: Config,
    private getKey: JWTVerifyGetKey,
  ) {}
  async verify(token: string): Promise<Principal> {
    try {
      const { payload } = await jwtVerify(token, this.getKey, {
        algorithms: ['RS256', 'PS256', 'ES256'],
        issuer: this.config.issuer,
        audience: resource(this.config),
        requiredClaims: ['exp', 'iat', 'sub', 'iss', 'aud'],
        clockTolerance: 5,
      });
      // Keycloak access tokens carry typ=Bearer; never accept an OIDC ID token here.
      if (
        payload.typ !== 'Bearer' ||
        !payload.sub ||
        typeof payload.scope !== 'string' ||
        typeof payload.iat !== 'number' ||
        payload.iat > Date.now() / 1000 + 5
      )
        throw new Error('Invalid access token');
      const scopes = payload.scope.split(/\s+/).filter(Boolean);
      if (!scopes.includes(READ_SCOPE))
        throw new AppError(
          'MCP_SCOPE_REQUIRED',
          'Innloggingen mangler nødvendig BookStack-scope.',
          403,
        );
      return { issuer: payload.iss!, subject: payload.sub, scopes, expiresAt: payload.exp! };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        'MCP_LOGIN_REQUIRED',
        'Innlogging til MCP mangler, er ugyldig eller har utløpt. Koble til på nytt.',
        401,
      );
    }
  }
}

export async function createIdentityProvider(config: Config): Promise<IdentityProvider> {
  const clientSecret = readPrivateFile(config.webClientSecretFile);
  if (!clientSecret) throw new Error('Webklientens hemmelighet er tom.');
  const safeFetch: oidc.CustomFetch = (input, init) =>
    fetch(input, {
      ...init,
      body: init.body as BodyInit | undefined,
      redirect: 'error',
      signal: init.signal ?? AbortSignal.timeout(15_000),
    });
  const discoveryOptions: oidc.DiscoveryRequestOptions = {
    [oidc.customFetch]: safeFetch,
    ...(config.allowInsecureLocalhost && config.issuer.startsWith('http:')
      ? { execute: [oidc.allowInsecureRequests] }
      : {}),
  };
  const client = await oidc.discovery(
    new URL(config.issuer),
    config.webClientId,
    clientSecret,
    oidc.ClientSecretPost(clientSecret),
    discoveryOptions,
  );
  oidc.enableNonRepudiationChecks(client);
  const metadata = client.serverMetadata();
  if (metadata.issuer !== config.issuer)
    throw new Error('OIDC issuer stemmer ikke med konfigurasjonen.');
  for (const endpoint of [
    metadata.authorization_endpoint,
    metadata.token_endpoint,
    metadata.jwks_uri,
  ]) {
    if (
      !endpoint ||
      assertSafeUrl(endpoint, config.allowInsecureLocalhost).origin !==
        new URL(config.issuer).origin
    ) {
      throw new Error('Keycloak auth/token/JWKS må ligge på konfigurert issuer-origin.');
    }
  }
  if (!metadata.code_challenge_methods_supported?.includes('S256'))
    throw new Error('Keycloak må annonsere PKCE S256.');
  const getKey = createRemoteJWKSet(new URL(metadata.jwks_uri!), { timeoutDuration: 10_000 });
  const verifier = new TokenVerifier(config, getKey);
  const callbackUri = `${config.publicOrigin}/auth/callback`;
  return {
    verify: (token) => verifier.verify(token),
    async login(attempt) {
      return oidc.buildAuthorizationUrl(client, {
        redirect_uri: callbackUri,
        scope: `openid profile ${READ_SCOPE}`,
        response_type: 'code',
        resource: resource(config),
        state: attempt.state,
        nonce: attempt.nonce,
        code_challenge: await oidc.calculatePKCECodeChallenge(attempt.verifier),
        code_challenge_method: 'S256',
      }).href;
    },
    async callback(url, attempt) {
      try {
        const tokens = await oidc.authorizationCodeGrant(
          client,
          url,
          {
            pkceCodeVerifier: attempt.verifier,
            expectedState: attempt.state,
            expectedNonce: attempt.nonce,
            idTokenExpected: true,
          },
          { resource: resource(config) },
        );
        const claims = tokens.claims();
        const principal = await verifier.verify(tokens.access_token);
        if (!claims || claims.iss !== principal.issuer || claims.sub !== principal.subject)
          throw new Error('Identity mismatch');
        return principal;
      } catch {
        throw new AppError(
          'MCP_LOGIN_FAILED',
          'Innloggingen kunne ikke bekreftes. Start innloggingen på nytt.',
          401,
        );
      }
    },
  };
}

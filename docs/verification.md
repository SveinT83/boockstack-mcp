# Verification report

Date: 2026-11-13, Europe/Oslo. This report distinguishes local implementation checks from production acceptance.

## Local checks

| Check                                                                                      | Result                                                                                                                                             |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Locked dependency installation (`npm ci`)                                                  | Passed                                                                                                                                             |
| Formatting (`npm run format:check`)                                                        | Passed                                                                                                                                             |
| TypeScript (`npm run typecheck`)                                                           | Passed                                                                                                                                             |
| Automated tests (`npm test`)                                                               | 72 passed; 0 failed                                                                                                                                |
| Compiled build (`npm run build`)                                                           | Passed                                                                                                                                             |
| Compiled-runtime smoke check (`npm run smoke:runtime`)                                     | Passed with a local mock OIDC issuer and temporary SQLite state                                                                                    |
| Production-dependency audit (`npm audit --omit=dev --audit-level=moderate`)                | 0 reported vulnerabilities at check time; not a security certification                                                                             |
| Compose configuration, including loopback publication and one correctly quoted tmpfs mount | Validated with an example PUBLIC_HOST                                                                                                              |
| Docker image build/run on this workstation                                                 | Not performed: current user cannot access the Docker socket                                                                                        |
| GitHub CI                                                                                  | Workflow added for formatting, typing, tests, compiled-runtime smoke, Compose validation, and Docker image build; check its run for remote results |

The runtime smoke check launches `dist/main.js`, checks local mock discovery and SQLite initialization, reads liveness/metadata/public instructions, confirms anonymous MCP requests get 401 and setup requires login, then confirms SIGTERM exits successfully. The mock is test-only, is destroyed after the run, and is never selected by production startup.

Tests cover:

- Valid signed JWTs and rejection of wrong issuer, audience, signature, expiry, missing claims, future timing, wrong token type, and insufficient scope.
- Authentication before tool discovery/calls and GET/DELETE session operations; explicit write-scope challenges.
- Exact Host/Origin boundaries, ignored caller-supplied identity/URL arguments, and bounded request/response handling.
- AES-GCM tampering detection and identity-bound ciphertext; isolation by issuer and subject; concurrent users' API requests use their respective keys.
- Private file permissions, encrypted credential/session data, file-backed restore with matching keys, failure with wrong keys, rotation, session expiry, and logout.
- PKCE/state/nonce, browser flow binding and replay rejection, real OIDC discovery/JWKS exchanges through `openid-client`/`jose`, invalid ID-token signatures, and ID/access subject mismatches.
- CSRF/same-origin protection, validation before storage, safe replacement/removal, and preservation of an existing key after validation failure.
- Search, browsing, reading, page creation/editing, and book/chapter creation/editing against isolated mocks of the v26.09.2 API contract.
- Key rejection/expiry, permission errors, hidden/missing content, validation failures, rate limits, upstream failures, malformed/oversized responses, and unknown write outcomes without automatic retry.
- Real loopback HTTP redirect refusal, proving the redirect target receives no personal credentials.
- Official MCP SDK client calls over real loopback HTTP, both legacy 2025-11-25 and pinned 2026-07-28 protocol flows.
- Safe errors/logs with correlation IDs and no credentials or unnecessary document bodies.

## Read-only observations of the actual target

`BOOKSTACK_MCP_CONFIG=/var/Projects/mcp-bookstack/config/example.json npm run check-upstream` reported:

- `GET https://doc.tronderdata.no/login`: HTTP 200, public asset version `v26.09.2`.
- `GET https://doc.tronderdata.no/api/docs`: HTTP 302 to login.
- Authenticated `/api/system` and book-list reads: not tested; no personal API credential was supplied.
- Production content writes: none.

The exact v26.09.2 API routes, controllers, auth guard, and relevant translations were inspected from official versioned source. Public asset version evidence is explicitly weaker than an authenticated `/api/system` response. Sources are linked in [research notes](research.md).

## Reference pilot deployment follow-up

The user subsequently authorized an isolated deployment on 2026-11-13. The earlier implementation-only observations above remain historical evidence rather than a claim that no deployment has occurred.

- The source implementation at commit `3468199` was built and deployed as a separate compose project. The existing BookStack MCP was kept running unchanged.
- The new container is healthy, runs as UID/GID 1000, uses a read-only root filesystem and dropped capabilities, and has separate private state and encryption-key files.
- The public origin is `https://bookstack-mcp.tronderdata.no`; the canonical MCP resource is that origin plus `/mcp`. DNS and a valid TLS certificate were verified. A dedicated automatic renewal job was installed and a certificate-renewal staging dry-run passed.
- The HTTPS proxy preserves the authentication challenge and correlation headers. Anonymous `tools/list` receives HTTP 401, `/setup` requires login, metadata advertises the intended resource/issuer/scopes, and `/healthz` returns 200.
- The actual Keycloak instance is version 26.6.2, with issuer `https://auth.tronderdata.no/realms/tronderdata`. Dedicated `bookstack-mcp-web` and `bookstack-mcp-api` clients and `bookstack:read`/`bookstack:write` scopes were added without changing existing clients or restarting Keycloak.
- The confidential web client uses an exact callback, PKCE S256, a five-minute access-token lifetime, no password/implicit/service-account grants, and its dedicated read scope. Audience mapping targets the exact MCP URI. Its secret was transferred encrypted between servers, without appearing in chat or logs. Temporary transfer helpers were removed.
- Real login initiation reaches the expected Keycloak login form with HTTP 200 and no invalid-client/redirect/scope error. A deliberately invalid authorization-code probe returned `invalid_grant` rather than `invalid_client`, confirming client authentication without obtaining a user token. This is not a completed personal OAuth exchange.
- Native resource indicators and CIMD are disabled on the shared Keycloak instance. This pilot uses a fixed audience mapper for its web client. Native RFC 8707 target rejection and the future ChatGPT client's registration/grant behavior remain unverified; no full authorization-server conformance is claimed and no global feature was enabled implicitly.

Private operational paths, rollback notes, and deployment inventory are maintained outside this public repository. No credentials, database copies, or private infrastructure inventory are committed here.

## Private workspace plugin follow-up

A portable plugin package was created and saved in the authenticated user's active workspace on 2026-11-13. The saved release was read back to verify its skill and direct MCP configuration. The dedicated `bookstack-mcp-chatgpt` public OAuth client uses PKCE S256, five-minute access tokens, refresh tokens, a default read scope, and an optional write scope. No client secret is packaged or required.

Its exact stable callback was verified against OpenAI's published client metadata and issuer-identification support. A no-session request to the real authorization endpoint accepted the callback and requested scopes, returning `login_required` plus the expected issuer. This proves configuration acceptance, not a completed personal authorization. Installation and workspace sharing remain user actions; the new plugin's tools have not yet appeared in this chat.

## Not yet verified

- A completed personal OAuth callback/session, issued user-token claims, MFA, and the future MCP client's refresh-token lifecycle.
- Native resource-indicator/CIMD behavior and the future ChatGPT client registration.
- Personal BookStack token submission through the production HTTPS proxy.
- Authenticated personal BookStack reads and permission separation for two real technicians.
- Actual key ownership: the supported BookStack API does not expose a caller-identity endpoint in this version. The personal-ownership confirmation is not technical proof.
- End-to-end OAuth, discovery, reading, writing, and disconnect/revocation behavior inside ChatGPT Business.
- Production backup/restore acceptance, service-specific monitoring, and encryption-key rotation on the target host.

The initial implementation phase did not change production systems. The authorized pilot subsequently added its own container, DNS record, proxy configuration, certificate renewal, and dedicated Keycloak clients/scopes. The separately authorized plugin phase created the private workspace package and its own OAuth client. Production BookStack content and existing MCP services were not changed. The [deployment checklist](production-checklist.md) contains the remaining acceptance steps.

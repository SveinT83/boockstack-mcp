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

## Not yet verified

- Actual Keycloak server version/realm, resource-indicator/CIMD configuration, client registrations, audience/scopes, MFA, and refresh-token lifecycle.
- Actual browser login and token submission through the production HTTPS proxy.
- Authenticated personal BookStack reads and permission separation for two real technicians.
- Actual key ownership: the supported BookStack API does not expose a caller-identity endpoint in this version. The personal-ownership confirmation is not technical proof.
- End-to-end OAuth, discovery, reading, writing, and disconnect/revocation behavior inside ChatGPT Business.
- Production container execution, backups/restores, monitoring, and encryption-key rotation on the target host.

No existing MCP server, Keycloak, production BookStack, DNS, or reverse proxy was changed. No ChatGPT plugin was created. The [deployment checklist](production-checklist.md) contains the proposed changes and acceptance steps for the next phase.

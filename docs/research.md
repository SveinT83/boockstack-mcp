# Research and compatibility notes

Checked on 2026-11-13. Only read-only service requests were made. No existing MCP, BookStack configuration, Keycloak configuration, DNS, or proxy was modified.

## BookStack evidence

The configured initial target is [doc.tronderdata.no](https://doc.tronderdata.no). `GET /login` returned 200 and public CSS/JavaScript asset URLs with `version=v26.09.2`. `GET /api/docs` returned 302 to `/login`. The target's authenticated API documentation and `/api/system` could not be inspected because no personal API credential was supplied.

The implementation was therefore based on the source for that exact observed release, rather than assuming that every endpoint in the current public demo exists on the target:

- [v26.09.2 API routes](https://github.com/BookStackApp/BookStack/blob/v26.09.2/routes/api.php): finite search, shelves/books/chapters/pages read paths; create/update paths; `/system`; user management without a current-user route.
- [SystemApiController](https://github.com/BookStackApp/BookStack/blob/v26.09.2/app/App/SystemApiController.php): system version and instance metadata, without caller identity.
- [PageApiController](https://github.com/BookStackApp/BookStack/blob/v26.09.2/app/Entities/Controllers/PageApiController.php): Markdown/HTML content fields, book/chapter parents, and normal BookStack permission checks.
- [UserApiController](https://github.com/BookStackApp/BookStack/blob/v26.09.2/app/Users/Controllers/UserApiController.php): user read/list operations require user-management permission and do not identify the API-token caller.
- [ApiTokenGuard](https://github.com/BookStackApp/BookStack/blob/v26.09.2/app/Api/ApiTokenGuard.php): rejected token IDs/secrets return 401; expired tokens and missing API permission return 403.
- [English errors](https://github.com/BookStackApp/BookStack/blob/v26.09.2/lang/en/errors.php) and [Norwegian errors](https://github.com/BookStackApp/BookStack/blob/v26.09.2/lang/nb/errors.php): exact expiry-message strings used by the bounded error classifier. Raw messages are never forwarded/logged.
- [Official demo API reference](https://demo.bookstackapp.com/api/docs) and [BookStack extension/API documentation](https://www.bookstackapp.com/docs/admin/hacking-bookstack/): general authentication and API format reference; the versioned source takes precedence for this implementation.

The optional GET-only check script can later confirm `/api/system` with a personal token and test one book listing. The secure setup form also validates the exact configured expected version on every save. A version mismatch blocks saving; existing keys are not silently invalidated by this local version guard. Review upgrades before changing `expectedBookstackVersion`. The service does not query `/api/system` before every tool call.

## Ownership and error limits

No supported API endpoint in the inspected route set supplies the caller's identity. Looking up a user by email or supplying a user ID would neither identify the token's owner nor prove an issuer/subject binding. This implementation intentionally makes no such claim. BookStack still enforces the token owner's actual rights, including when a person submits the wrong token.

BookStack lacks a locale-independent auth reason code beyond HTTP status here. Exact known expiry messages distinguish the verified release's English/Bokmål expired-token errors from other 403 responses. An unrecognized locale/custom error body remains a permission/access error with instructions to check expiry too. Error bodies are size-limited and never returned to the model.

## OAuth and MCP references

- [MCP authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization): protected-resource and authorization-server roles, discovery, resource indicators, scopes, and client registration.
- [Official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk): supported MCP server/client and Node HTTP adapter. Installed versions were checked in the npm registry and locked. `createMcpHandler` serves the current per-request protocol and the SDK's stateless compatibility path; authentication runs in front of both.
- [OpenAI plugin authentication](https://developers.openai.com/plugins/build/auth): ChatGPT authorization-code/PKCE flow, protected-resource discovery, supported client-registration options, issuer identification, and callback differences. A plugin management page must supply the exact callback/metadata values at setup time.
- [Keycloak MCP integration](https://www.keycloak.org/securing-apps/mcp-authz-server): resource-indicator and CIMD compatibility, client profiles, registration choices, and audience binding. These features are currently documented as experimental; their availability on the user's actual installation is unverified.
- [Keycloak OIDC endpoints](https://www.keycloak.org/securing-apps/oidc-layers): discovery, authorization, token, JWKS, refresh, and revocation endpoints.
- [openid-client](https://github.com/panva/openid-client) and [jose](https://github.com/panva/jose): OIDC and JWT libraries. Signed local test issuers exercise the actual libraries rather than substituting token parsing for signature verification.

An external Keycloak authorization server was selected to keep this service small and avoid maintaining a second token issuer, OAuth consent implementation, or registration service. This places explicit production requirements on Keycloak; a normal web-login registration alone cannot establish the direct ChatGPT flow. No OAuth proxy, simulated production identity provider, or shared administrator API token has been substituted for missing configuration.

## Operational references

Existing local MCP project READMEs/container manifests were inspected for conventions: loopback host publication, a non-root runtime, separate secrets, dropped capabilities, and explicit distinction between tests and deployed verification. Their credentials and code were not copied. Internal deployment details from those projects are not part of this public repository.

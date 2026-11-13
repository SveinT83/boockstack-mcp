# Production deployment checklist

This document proposes later production changes. None have been applied. Example hostnames and client names must be reviewed before use.

## Inputs still required

- [ ] Decide the public HTTPS origin, host, service account, and port. `bookstack-mcp.example.org` is a placeholder, not an existing DNS record.
- [ ] Confirm the actual Keycloak installation version and exact realm issuer. No usable realm, client registration, client secret, or Keycloak administration access was supplied for this project.
- [ ] Confirm the current BookStack API version with a personal token and inspect that instance's authenticated `/api/docs`. Public asset URLs reported v26.09.2 on 2026-11-13.
- [ ] Select a maintainer, log retention, backup location, recovery objectives, and an incident access-blocking procedure.

## Keycloak: separate resource, web client, and MCP client

Reference: [Keycloak MCP authorization guide](https://www.keycloak.org/securing-apps/mcp-authz-server) and [OpenAI plugin authentication](https://developers.openai.com/plugins/build/auth). Match these instructions to the installed version; resource indicators and CIMD are currently documented as experimental. Review compatibility and impact on the shared Keycloak deployment before enabling features.

- [ ] Reserve the resource URI `https://<public-host>/mcp`; configure a resource-server client with `resource_url` set to that exact URI. Enable/review `resource-indicators` and configure the authorized clients' audience mapper as described in the Keycloak guide.
- [ ] Create `bookstack:read` and `bookstack:write` client scopes, included in access-token `scope`. Attach only approved scopes to each client and constrain grants with the intended user/group policy. These service scopes do not replace BookStack content permissions.
- [ ] Register a separate confidential OIDC web client, such as `bookstack-mcp-web`: authorization code only, PKCE S256 required, token authentication `client_secret_post`, exact redirect `https://<public-host>/auth/callback`. Disable direct access/password grants, implicit flow, and service accounts. Enable `openid profile bookstack:read`; issue access tokens with the MCP resource audience and `typ=Bearer`. Keep its secret in the separate private file.
- [ ] Use public/stable subjects for both web and ChatGPT clients. Verify the same user's exact issuer and subject match across both flows; email similarity is not sufficient.
- [ ] Set a short access-token lifetime, for example five minutes. Review refresh-token rotation/reuse detection and consent. Permit refresh grants for ChatGPT as required by its client flow; the setup website does not retain refresh tokens.
- [ ] Verify OIDC discovery exposes the exact issuer, HTTPS auth/token/JWKS endpoints on the same origin, supported signature algorithms, and `code_challenge_methods_supported` containing `S256`. The app rejects missing S256 or mismatched endpoints at startup.
- [ ] Verify both authorization and token requests handle the canonical `resource`, and wrong targets are rejected. Check audience and scope claims without printing tokens to logs.

Choose one supported registration mechanism for the future ChatGPT connection:

- [ ] **Pre-registration:** use an explicitly registered client when the plugin builder supports supplied client credentials. Copy its exact callback URI from that builder; configure exact redirects and PKCE. No wildcard redirects.
- [ ] **CIMD:** if selected, review/enable `cimd`, configure the `client-id-uri` policy and `client-id-metadata-document` executor, restrict trusted metadata domains and resource-indicator allowlist, and allow the selected token authentication method. Inspect the actual ChatGPT metadata and linked domains first. The MCP service does not fetch or register client metadata itself.
- [ ] **DCR:** if selected instead, review the realm's anonymous client-registration policies, scope/redirect/host restrictions, rate limits, and credential lifetime. Never assume a default Keycloak realm permits anonymous ChatGPT registration.

The plugin builder shows the applicable ChatGPT client metadata URL and redirect URI. Depending on issuer-identification support, callbacks can be stable or connection-specific. Copy the values actually shown; do not hardcode an old callback from another plugin. Verify RFC 9207 issuer identification where supported.

## HTTPS, runtime, and secrets

- [ ] Create/review DNS and a valid TLS certificate for the dedicated public origin.
- [ ] Review the supplied nginx proposal or equivalent proxy configuration. Preserve Host/Authorization, disable response caching/buffering, and ensure proxy/WAF logs do not capture authorization codes, tokens, cookies, or form data.
- [ ] Permit ChatGPT to reach MCP discovery and `/mcp` over public HTTPS. Permit the required Keycloak public endpoints. A technician's private LAN/VPN does not satisfy this.
- [ ] Permit the server to reach only the configured BookStack and necessary Keycloak endpoints, with valid TLS. No user-selectable BookStack base URL or redirect-following is provided.
- [ ] Provision the private state directory and separate keyring/client-secret files, with the modes/UID documented in README. Back up database and encryption keys separately.
- [ ] Fill operator configuration from `config/example.json`; use `host: 0.0.0.0` only inside the supplied bridge-network container and keep its host port bound to loopback. Configure exact trusted proxy addresses for rate limiting.
- [ ] Build and test the container on an authorized Docker host. Validate the locked base-image digest for the deployment platform. `docker compose config --quiet` can be checked without starting services.
- [ ] Record the deployed Git commit/image digest. Run a single service replica with persistent local SQLite storage.
- [ ] Test liveness, unauthenticated MCP rejection, TLS, full web login, and private session-cookie flags through the actual proxy.
- [ ] Test backup and isolated restore using the actual backup system. Exercise encryption-key rotation with old backups available.

## Personal BookStack access

- [ ] Each technician creates their own BookStack API token with a reviewed expiry date. Confirm Access System API; preserve existing content roles.
- [ ] Open `/setup`, complete personal Keycloak login, submit the key through the browser form, and verify the authenticated BookStack version check.
- [ ] Acknowledge the API ownership-verification limitation. Do not represent the personal-ownership checkbox as technical proof of ownership.
- [ ] With two users holding different permissions, confirm both allowed content and denied/hidden content. Verify replacing/removing one user's key does not affect the other.
- [ ] Test expired/revoked tokens and API-disabled accounts. Confirm the expiry-message mapping for the actual BookStack language; other translations can produce an ambiguous 403.

## Future shared ChatGPT Business plugin

Do this only in the next phase; no plugin has been created by this delivery.

- [ ] Create a BookStack-specific plugin in the intended Business workspace, pointing directly to `https://<public-host>/mcp`, with OAuth enabled. Do not route through LiteLLM.
- [ ] Select the reviewed Keycloak client-registration method; enter any required pre-registered client credentials securely. Confirm scopes, redirect URIs, issuer identification, and refresh behavior.
- [ ] Configure workspace availability; each technician still completes their own authorization and key setup.
- [ ] Run connection status, search, navigation, and page reading from ChatGPT. Confirm the presented setup link works for missing keys.
- [ ] Test approved creation/editing in designated test content with least-privilege users. Verify write annotations/confirmation UX and BookStack authorization.
- [ ] Exercise missing/expired OAuth, missing/revoked API keys, denied content, and a safe network-failure scenario. Locate each correlation ID in application logs.
- [ ] Verify disconnect, local key deletion, and BookStack token revocation independently. Record which access persists until JWT expiry.
- [ ] Document the exact versions, public origin, verification evidence, owner, and remaining limitations before declaring the integration production-ready.

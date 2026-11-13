# BookStack ChatGPT plugin

`bookstack/` contains the portable Agent Plugins 1.0 package for the standalone MCP service. It includes a Norwegian workflow skill, a local SVG icon, and a direct Streamable HTTP connection. No LiteLLM route or credentials are packaged.

Build a ZIP outside the source directory:

```sh
python3 scripts/package-plugin.py /tmp/bookstack-plugin.zip
```

The package uses the separately registered Keycloak client `bookstack-mcp-chatgpt`. This is a public OAuth client with required PKCE S256 and `tokenEndpointAuthMethod: none`; no client secret is required. The browser setup client `bookstack-mcp-web` remains separate.

The reference client has the exact stable ChatGPT callback `https://chatgpt.com/connector_platform_oauth_redirect`. This URI was checked against OpenAI's published `https://chatgpt.com/oauth/client.json`, the current authentication guide, and this issuer's RFC 9207 discovery support. A no-session authorization request verified that Keycloak accepts this callback and returns `login_required` with the expected issuer. If the plugin management page shows a connection-specific callback instead, review and register that exact URI; never allow wildcard callbacks.

The base scope is `bookstack:read`; the requested default scopes are `bookstack:read` and `bookstack:write`. Keycloak grants read by default and exposes write as an optional scope. OIDC requests use `openid`, `profile`, and `email`. The plugin relies on the MCP service's protected-resource discovery for issuer and endpoint discovery.

ChatGPT's actual connection flow also requests `offline_access`. Assign the existing Keycloak `offline_access` client scope as optional on this dedicated client; omitting it caused `invalid_scope` for the full requested scope string. The exact request `openid email offline_access bookstack:read bookstack:write` was checked against the live authorization endpoint after the correction: a no-session probe now returns `login_required`, while an unassigned `bookstack:admin` scope still returns `invalid_scope`. Offline sessions must be reviewed and revoked separately when withdrawing access; browser logout alone is not revocation. Do not advertise `offline_access` as a BookStack protected-resource permission.

A private workspace plugin was created from this package on 2026-11-13. Creation is not installation, personal authorization, workspace-wide sharing, or verified end-to-end access. The workspace owner must add the plugin and complete personal OAuth consent. Share it through Plugins → Created by you → BookStack → Share for the intended workspace audience. A public source repository does not publish the private plugin to the public directory.

Each user registers their own BookStack token at the MCP service's `/setup` page. Never paste a token into ChatGPT. Verify connection status, a known permitted page, and a denied page before testing approved edits in designated test documentation.

## Required ChatGPT MCP registration

The initial archive upload saved the package and skill, but did not establish a registered ChatGPT MCP app. A subsequent ChatGPT test had no tools from this direct server and instead used an unrelated gateway. No request reached this server during that test. The archive upload and successful server-side OAuth probes must not be reported as a working ChatGPT connection.

Follow [OpenAI's registered MCP connection workflow](https://developers.openai.com/plugins/build/plugins#create-and-test-a-plugin-locally-with-an-mcp-server): ChatGPT Plugins → plus button → Add custom MCP server → configure the existing endpoint and the provided OAuth client → Create as a plugin. Obtain the resulting registered app/plugin reference and its actual callback information. Bind that verified app to the package through `.app.json` and the manifest's OpenAI app declaration; do not invent an app ID or consider the portable MCP file alone proof of a registered app connection.

Version 0.1.1 makes the skill stop when its own direct tools are unavailable. Gateway results must never substitute for verification of the direct integration. The app binding and successful personal ChatGPT call are still pending; the MCP service and stored personal credential are unchanged.

## Observed Codex Desktop compatibility limit

On 2026-11-13, Codex Desktop 26.1106.51428 installed this plugin and loaded its skill, but its MCP loader rejected the portable server's OpenAI OAuth extension with `unknown field extensions, expected url or headers`. No authenticated MCP tools from this plugin became available in that chat. Installation therefore did not establish a working MCP connection in that client version.

Keep the OAuth configuration intact for ChatGPT; stripping it merely to satisfy an older parser would remove the intended pre-registered client configuration. Verify the personal OAuth connection and a harmless `bookstack_connection_status` call in ChatGPT. Codex support requires a client that accepts this configuration or a separately reviewed native connection setup. Do not substitute the older gateway BookStack tools as evidence for this direct plugin.

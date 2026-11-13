# BookStack ChatGPT plugin

`bookstack/` contains the portable Agent Plugins 1.0 package for the standalone MCP service. It includes a Norwegian workflow skill, a local SVG icon, and a direct Streamable HTTP connection. No LiteLLM route or credentials are packaged.

Build a ZIP outside the source directory:

```sh
python3 scripts/package-plugin.py /tmp/bookstack-plugin.zip
```

The package uses the separately registered Keycloak client `bookstack-mcp-chatgpt`. This is a public OAuth client with required PKCE S256 and `tokenEndpointAuthMethod: none`; no client secret is required. The browser setup client `bookstack-mcp-web` remains separate.

The reference client has the exact stable ChatGPT callback `https://chatgpt.com/connector_platform_oauth_redirect`. This URI was checked against OpenAI's published `https://chatgpt.com/oauth/client.json`, the current authentication guide, and this issuer's RFC 9207 discovery support. A no-session authorization request verified that Keycloak accepts this callback and returns `login_required` with the expected issuer. If the plugin management page shows a connection-specific callback instead, review and register that exact URI; never allow wildcard callbacks.

The base scope is `bookstack:read`; the requested default scopes are `bookstack:read` and `bookstack:write`. Keycloak grants read by default and exposes write as an optional scope. OIDC requests use `openid`, `profile`, and `email`. The plugin relies on the MCP service's protected-resource discovery for issuer and endpoint discovery.

A private workspace plugin was created from this package on 2026-11-13. Creation is not installation, personal authorization, workspace-wide sharing, or verified end-to-end access. The workspace owner must add the plugin and complete personal OAuth consent. Share it through Plugins → Created by you → BookStack → Share for the intended workspace audience. A public source repository does not publish the private plugin to the public directory.

Each user registers their own BookStack token at the MCP service's `/setup` page. Never paste a token into ChatGPT. Verify connection status, a known permitted page, and a denied page before testing approved edits in designated test documentation.

## Observed Codex Desktop compatibility limit

On 2026-11-13, Codex Desktop 26.1106.51428 installed this plugin and loaded its skill, but its MCP loader rejected the portable server's OpenAI OAuth extension with `unknown field extensions, expected url or headers`. No authenticated MCP tools from this plugin became available in that chat. Installation therefore did not establish a working MCP connection in that client version.

Keep the OAuth configuration intact for ChatGPT; stripping it merely to satisfy an older parser would remove the intended pre-registered client configuration. Verify the personal OAuth connection and a harmless `bookstack_connection_status` call in ChatGPT. Codex support requires a client that accepts this configuration or a separately reviewed native connection setup. Do not substitute the older gateway BookStack tools as evidence for this direct plugin.

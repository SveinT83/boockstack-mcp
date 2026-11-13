# Security policy

This project is an initial 0.1 implementation. Only the current main branch is maintained; no production security certification or completed external audit is claimed.

Do not include real API tokens, OAuth tokens/client secrets, cookies, database files, encryption keyrings, or private documents in issues, pull requests, screenshots, or logs.

Use GitHub's private vulnerability reporting for this repository when available. If it is unavailable, contact the repository owner privately to arrange a secure reporting channel before sharing exploit details. Do not open a public issue containing credentials or an exploitable security report.

An incident involving a BookStack token requires revoking that token in BookStack. Deleting a stored copy or disconnecting an MCP client does not invalidate other copies. Keycloak JWT access tokens are checked locally and can remain valid until expiry; see README for the revocation limits and immediate blocking options.

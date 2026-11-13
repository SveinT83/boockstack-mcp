# Contributing

Use Node.js 22.23 or newer. Install locked dependencies with `npm ci`, then run:

```sh
npm run typecheck
npm test
npm run build
npm run smoke:runtime
```

Tests must use generated keys, temporary databases, loopback-only identity providers, and BookStack mocks. Keep production reads optional and production writes outside automated tests. Do not add an authentication bypass, a shared administrator fallback, an arbitrary URL/HTTP tool, or a user-selectable identity argument.

For changes affecting BookStack endpoints, cite the supported version's official source/API documentation and update contract tests. For identity or storage changes, test rejected credentials and isolation between different issuer/subject pairs. Keep API secrets and document content out of logs and model-visible errors.

Explain the behavior change, validation performed, and remaining limitations in pull requests. Update the English README and relevant operator/user guides. Report security issues privately as described in SECURITY.md.

# D-AUTH-OIDC — turnkey auth delegates to OIDC; Loom does not build an auth runtime

**Status:** PINNED.

**Problem.** `quickstart-and-day-one-batteries.md` §4 ("turnkey auth") sketched
a self-built auth runtime: an `auth { providers: [email, google, github] }`
block that makes Loom generate an `AuthUser` aggregate with **hashed
passwords**, signup/login/verify-email endpoints, OAuth clients, session
issuance, and login/signup UI — across Hono, .NET, **and** Phoenix, × four
design packs. That is a large, security-critical, perpetually-maintained
surface for a code generator to own.

**Decision.** Turnkey auth **delegates to an OIDC identity provider**.
**Keycloak** is the self-hostable default; Auth0 / Cognito / Zitadel / Ory /
Entra ID are the same thing to Loom — an `issuer` URL. "Don't roll your own
auth": Loom **validates tokens and maps claims into the existing typed
`user {}` shape**; the IdP owns credential storage, password reset, MFA,
lockout, and the hosted login/signup pages. Loom generates **no `AuthUser`
aggregate, no password column, no OAuth client code** — only an OIDC verifier
(the batteries-included fill-in for the already-shipped
`IUserVerifier` / `registerUserVerifier` seam), the `/auth/login|callback|logout`
redirect handshake, session issuance, and a route guard.

**Rationale.**

- "Don't roll your own auth" is the strongest security guidance in the field;
  passwords/MFA/reset/lockout are deep and ruinous to get wrong.
- OIDC is the universal protocol — every IdP plugs in uniformly behind one
  `issuer`. Loom's per-backend work shrinks to "validate a token" (mature libs
  everywhere: `jose`, `Microsoft.Identity`, `oidcc`/`Ueberauth`) + a redirect.
- It **completes** what `auth.md` already ships (typed `user {}`,
  `currentUser`, `requires`, `auth: required` middleware, the verifier hook)
  rather than adding a new runtime. OIDC is just the batteries-included
  verifier.
- The multi-backend × multi-pack cost of a hand-built password/session/login-UI
  runtime is a maintenance + security liability where any divergence is a
  vulnerability.

**Zero-config quick-start.** The one cost of self-hosted OIDC — standing up an
IdP — is closed by **bundling a dev IdP**: the generated `docker-compose.yml`
adds a Keycloak service with a pre-provisioned realm + a **seeded demo user**
(seeding feature, `database-seeding.md` §5.4), so `docker compose up` logs in
out of the box; production repoints `issuer:` at a real IdP. The on-ramp owns
zero auth logic.

**Consequences.** The `auth {}` surface is reframed from
`providers: [email, google, github]` to `auth { oidc { issuer, clientId, … } }`
+ a `claims:` map. A self-contained email/password mode, if ever wanted, is a
**secondary, library-backed** option — never hand-rolled across backends, and
not the headline. Default-deny enforcement (`enforcement: denyByDefault`) is
unaffected.

**Affects.** `quickstart-and-day-one-batteries.md` §1 (battery list), §3.1
(`saas` template), §4 (entire turnkey-auth section), §7 (build order);
`auth.md` (the verifier-hook seam is OIDC's mount point — no rewrite, just the
completion it always anticipated).

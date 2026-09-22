# Loom dev-experience evaluation — "Assure" claims platform

Persona: a backend-leaning full-stack developer who has read the README and
`docs/language.md`'s table of contents, and now wants to build a real system.
Domain: a unified **claims** platform spanning insurance (policy claims),
banking (payouts), and e-shop (merchandise returns).

Rules I hold myself to:
- Use the CLI the way the README says.
- When the compiler refuses, read the diagnostic first and the docs second.
- Record *time lost* and whether the failure was HONEST (a `loom.*` diagnostic)
  or SILENT (exit 0, broken output).

## Timeline

| # | step | outcome |
|---|---|---|
| 1 | `ddd new claims --platform node --template crud` | works; scaffold is well commented (but see F-116) |
| 2 | wrote v1 by hand (2 contexts, 4 aggregates) | 4 parse rounds: `part`→`entity` (F-117-adjacent), no `date` (F-110), `money` vs `Money` VO, `derived display` required by the UI layer |
| 3 | `generate system` v1 → `tsc --noEmit` on api + portal | **both clean** |
| 4 | v2: tenancy + denyByDefault auth + permissions/policy | diagnostics were excellent and led me straight to `auth: required`, `crudish(requires:)`, gates |
| 5 | v2: split `Claims` onto its own deployable | **F-108** — 18 generated-page errors, no cause named, and `targets:` cannot take two backends. Reverted the split. |
| 6 | v2: payouts on a second platform + RabbitMQ saga | channelSource syntax, `delivery/retention` compatibility, `by e.<field>` correlation — all caught honestly |
| 7 | `tsc --noEmit` on the v2 api | **F-101** (outbox factories missing), then **F-103** (`currentUser` in a reactor) |
| 8 | booted postgres + rabbit + keycloak + the api natively | boots, migrates, enforces auth, 401 without a token |
| 9 | drove the full claim lifecycle with a real OIDC token | worked; the realm's demo user needed a hand-added `permissions` attribute first (#2948) |
| 10 | two-tenant isolation probe | **verified**: empty list, 404 by id, 404 on write |
| 11 | v3: evolved the schema (rename + new required field + new enum value) | the rename guard fired, the declared rename produced correct SQL, **applied live with no data loss** |
| 12 | v3: hand-written workbench page + projection | **F-102** (cross-context VO import), **F-107** (money in a slot), **F-106** (`money.round(n)`) |
| 13 | v3: unit `test` blocks | **F-105** — operation-call arguments are not type-checked in a test body |
| 14 | id-type probes | **F-104** — `create({…})` accepts another aggregate's id |

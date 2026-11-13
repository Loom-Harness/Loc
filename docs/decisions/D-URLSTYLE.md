# D-URLSTYLE — lifecycle URL style on the api body + per-action routeSlug

**Status:** PINNED. Full design in
[`proposals/lifecycle-url-style.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/proposals/lifecycle-url-style.md);
amends `lifecycle-operations.md` Phase 2, whose grammar sketch assumed a
fictional per-aggregate `api … for <Aggregate> { urlStyle }` form.

**Problem.** `lifecycle-operations.md` Phase 2 specifies `urlStyle` on a
per-aggregate api with a body. The real grammar is
`api <Name> from <Subdomain>` — per-subdomain, body-less. The proposal's
text can't parse against the shipped grammar, so Phase 2 is designed
against the real model here.

**Decision.**

1. **`urlStyle` lives on the `api`, as an optional body** —
   `api SalesApi from Sales { urlStyle: literal | resource }`, default
   `literal` (D-LIFECYCLE-VERB). On the *api* (the shared contract), not
   the deployable (URL shape isn't per-process) nor a system default
   (too coarse; a system-default-with-override is a deferred v2 nicety).
   Grammar uses a direct optional property, not a members list, until a
   second api-body clause actually lands. `urlStyle`/`resource` are
   soft-admitted in `LooseName`/`NameRefIdent` (the `dataSource`/`money`
   precedent).
2. **`routeSlug` is a per-action `OperationIR` field, derived in
   enrichment** — not the proposal's separate `agg.lifecycle` shape (the
   Phase-1 `creates`/`destroys` arrays already partition by kind).
   Derivation: `canonical → undefined` (bare collection / canonical-id
   URL); `urlStyle: literal → name`; `urlStyle: resource → plural(name)`.
   The HTTP verb + path skeleton stays Phase-3 emitter logic keyed on
   `kind` + `canonical` + `routeSlug`.
3. **The surfacing api is resolved by subdomain.** Aggregate → one
   context → one subdomain → the api `from` it. Enrichment threads the
   subdomain's style into `enrichAggregate`. Top-level contexts (no api)
   default to `literal`. If two apis surface one subdomain with differing
   `urlStyle`, the **first declared wins** and the validator warns
   (`loom.subdomain-conflicting-urlstyle`).

**Consequences (not separate decisions).**

- **No generated-output change in Phase 2** — no backend reads
  `routeSlug` yet (emitters still build slugs inline as `snake(name)`),
  so fixtures stay byte-identical. The re-baseline lands in **Phase 3**,
  when emitters consume `routeSlug` and `resource`-style URLs change
  (a coordinated `rebaseline-Lifecycle` moment).
- **The verb-name warning** (`loom.url-style-naming-warn`,
  `cancel → /cancels`) is **deferred** — reliable verb detection needs a
  lexicon; low value vs false-positive cost.

**Affects.** `lifecycle-operations.md` Phase 2 + integration-seams
sections (superseded by `lifecycle-url-style.md`); `ApiIR.urlStyle`,
`OperationIR.routeSlug`; the enrichment pass; depends on D-LIFECYCLE-VERB.

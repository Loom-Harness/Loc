# Wave C0 — packet 0.6 hand-off: the fifteen rulings (moved from C5)

*Branch `claude/c0-decisions`, folded 2026-09-10. Entries under `# Wave C0.6 — the fifteen rulings batch` in `docs/decisions.md`; each `Status: proposed (default applies 48 h after merge unless overridden)`, two owner-only.*

| # | D-tag | default |
|---|---|---|
| 1 | `D-ENVELOPE-RATIFY` | `X envelope` = a find returning exactly one row; the `{id, ts, body}` carrier is dropped (consistent with #2852; no emitter has a ctor arm that could supply `ts`, and a fifth response shape contradicts pinned `D-ENVELOPE`) |
| 2 | `D-HANDLE-REMOVAL` | remove workflow `handle` + named `create`; `commandHandler` replaces — **owner-only** (`HandleDecl` has no `by` clause; option (a) is an addressing-surface design, not five emitters) |
| 3 | `D-FOR-IN-DOMAIN` | `for` in a domain body = honest gap + successor mission; `variant-match` outside a ui action and `if let` outside a workflow = permanent refusals |
| 4 | `D-NUMERIC-INGRESS-STRICT` | strict on the two real narrowings only — **owner-only**; the 40-digit-money DB 500 is a C1 defect |
| 5 | `D-DECIMAL-EXACT-MOMENT` | one PR: node + python + all 54 goldens under `LOOM_WIRE_UPDATE=1`; mints **RS-35** (RS-31–34 already taken) |
| 6 | `D-WRITE-TX` | save + outbox + audit + provenance in one tx; dispatch after commit. Stale premise corrected: mikroorm's save already wraps in `em.transactional` (`G2667-C4` landed); still open — .NET document/ES repos dispatch after `SaveChangesAsync` with no durable record, node workflow/extern/timer emits outside any tx, java's class-`@Transactional` asymmetry |
| 7 | `D-CROSSTENANT-ACK` | `policy { deny on X }` is the acknowledgment |
| 8 | `D-READ-SURFACE-ORDER` | re-verify → projection masking → the two small gates → system-read construct last |
| 9 | `D-LONG-AVG-DEFAULTS` | `long` gets a declared 2^53 ceiling (overflow = error); projection `avg` over money retypes to `money` |
| 10 | `D-DAPPER-ALTER` | build the ALTER path in phase ⑨ (T2 mission, mikroorm arm included); widened refusal lands first |
| 11 | `D-PROJECTION-IMPLICIT-SUB` | an `on(Event)` handler subscribes in-process with or without a channel |
| 12 | `D-FIRST-ON-EMPTY` | `first: T` fails on empty everywhere, `firstOrNull` is total — RS-36 (node returns `undefined`; elixir uses `List.first/1` for both today) |
| 13 | `D-ABSENT-JOIN-DATETIME-WIRE` | absent join value = `null` (ratifies RS-34); three fraction digits when present, none on a whole second (RS-4 kept) — RS-37 |
| 14 | `D-FLUTTER-BEARER` | native = bearer from the OIDC client; web = `withCredentials` cookie; the ordinary http client is fixed first |
| 15 | `D-MISC-C0` | `generateDotnetForContexts` boundary stays (promote `generator-dotnet.test.ts` first); `connection:` `service(x)` names an existing service, declaration beats derived topology; lowercase per-op OpenAPI tags on .NET + Java; `scopeId` = business boundary, not author-configurable in v1 |

Status lines linked to their D-tag: M-T6.57 (also P2 → P0 per its own fleet note), M-T6.58, M-T6.60, M-T6.35, M-T6.13, M-T5.28, M-T5.22, M-T5.23, M-T5.24, M-T4.3, M-T4.12, M-T4.2, M-T3.15, M-T3.6, M-T3.11, M-T9.52, M-T7.9, M-T1.20. Rows with no mission heading (`F2-EXPR-7`, B20, `G2667-D3`, `F2-W-06`) are attached to the nearest owner; 0.4 may mint headings. Gates: 4 docs suites 380 passed, lint exit 0, docs build OK.

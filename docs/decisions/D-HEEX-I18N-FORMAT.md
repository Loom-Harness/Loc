# D-HEEX-I18N-FORMAT — `i18nFormat` is a documented permanent LiveView divergence, not a gap

**Status:** applied — the proposed default took effect 2026-09-24 (merged to `main` 2026-09-22 in #2970; no override recorded by 2026-09-28; flipped by Wave C5 packet 5.0).
Raised by wave C2 packet 2a (§7.1 of its hand-off), which found the ledger's own
proposed disposition unavailable, and taken by packet 2m.

**Question.** `G2646-open-heex-layout-inert` carries two live arms. One is the
missing pager on a non-server-paged `Table` — built in packet 2m. The other is
the `i18nFormat` wrapper, which `heex-walker-core.ts`'s arm drops by design ("the
format is dropped: render the wrapped operand"). The ledger's fix line says
"honour it or pin it in the heex-parity freeze list with a reason" — but that
freeze list is over walker PRIMITIVES, and `i18nFormat` is an `ExprIR` kind, so
the pin it proposes does not exist.

**Options.** (a) add a CLDR-shaped number/date formatter dependency to every
generated Phoenix app and honour the wrapper; (b) ratify the drop as a permanent,
documented LiveView divergence and retire the arm from the ledger row; (c) mint
a `loom.*` code so the author is told their format is ignored.

**Decision.** (b), with the operand's rendering unchanged. The value still
renders — what is dropped is the LOCALE-AWARE FORMATTING of it.

**Rationale.**

- **(a) is a dependency decision wearing a gap's clothes.** The four JSX targets
  format through `Intl`, which is in every browser at zero cost. Phoenix renders
  on the server, where the equivalent is a CLDR library compiled into the app
  (`ex_cldr` and friends) — a new hex dependency, a compile-time locale set, and
  a per-app configuration surface, added to EVERY generated Phoenix app for a
  wrapper most models never use. That is a feature with a dependency ruling in
  it, not a drain.
- **(c) would fire on a model that is otherwise fully supported.** The i18n
  layer itself ships on this target — `pgettext` keys every user-visible slot,
  and packet-era work added the ICU engine for INTERPOLATION
  (`D-I18N-HEEX-ICU`). Only the number/date FORMAT wrapper is dropped. An error
  there would refuse a page whose text is already translated.
- **The drop is already local and documented at the emission site**, which is
  where a reader meets it.

**Consequences.** The `i18nFormat` arm is retired from
`G2646-open-heex-layout-inert`; with its pager arm built in packet 2m and its
Grid arm already retired as stale, the ledger row closes. The emission-site
comment in `src/generator/elixir/heex-walker-core.ts` is the record. If a
generated Phoenix app ever gains a CLDR dependency for another reason, this
ruling should be re-opened — the cost argument is the whole argument.

**Unblocks.** `G2646-open-heex-layout-inert` → `done` (wave **C2 packet 2m**).

**Sources.** `src/generator/elixir/heex-walker-core.ts` (the `i18nFormat` arm);
[`targets-completeness-2026-08-30.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/audits/targets-completeness-2026-08-30.md);
`D-I18N-HEEX-ICU` above (the interpolation half, which DID get an engine).

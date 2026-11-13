# Diagnostic catalog — the `loom.*` code registry

> Convention spec. **Every** diagnostic site in
> `src/language/validators/**`, `src/language/ddd-validator.ts`,
> `src/ir/validate/checks/**`, `src/macros/expander.ts` and `src/api/`
> attaches a `loom.*` code, and `test/system/diagnostic-catalog.test.ts`
> fails on the first one that does not. The wording of every code lives in
> `src/diagnostics/messages/<family>.ts` (merged by
> `src/diagnostics/messages.ts`; the family is the one whose `segments`
> owns the code's first segment); its language-reference anchor lives in
> the same family under `src/diagnostics/code-docs/`; a minimal `.ddd` that
> makes it fire lives in `test/system/diagnostic-firing-census.test.ts`. A
> new code owes all three.

## Why codes

A stable diagnostic code is the contract between a validator and
everything that consumes its output: the LSP (quick-fix targeting),
test assertions (`expect(diagnostics).toContainCode("loom.…")`), docs,
and users who search an error string. Free-text messages drift; codes
don't. **Every diagnostic Loom raises — parser, AST validator, IR
validator, system check — carries a `loom.<area>-<symptom>` code.**

## Naming

```
loom.<area>-<symptom>
```

- **`area`** — the feature/phase the check belongs to, lower-kebab:
  `storage`, `datasource`, `payload`, `error`, `criterion`, `lifecycle`,
  `policy`, `tenancy`, `i18n`, `sensitive`, `audit`, `provenance`,
  `deployable`, `react`, `slot`, `derived`.
- **`symptom`** — what is wrong, lower-kebab, phrased as the problem not
  the fix: `bare-aggregate-in-type`, `unmapped-error-status`,
  `findall-no-page`, `unnamed-placeholder`.

One code per distinct condition. Do not reuse a code across two
unrelated checks; do not mint two codes for one condition.

## Severity policy

| Severity | Use |
|---|---|
| **error** | the model cannot lower / generate correctly |
| **warning** | legal but suspect; a sharper form exists |
| **hint/info** | style nudge; LSP-only, never fails CI |

**Staged promotion.** A new constraint that would break existing
sources lands as a **warning**, then promotes to **error** in a later,
coordinated phase — keeping the *same code* across the promotion. This
is the exception-less D10 pattern (`loom.throw-outside-domain`: warning
A1–A3, error after A4) and is the default migration path for any
tightening rule. Document the promotion in the code's `code-docs` entry.

## Registry

The registry is the catalog itself: `src/diagnostics/messages.ts` (merged
from `src/diagnostics/messages/<family>.ts`) lists every code with its
wording, and `src/diagnostics/code-docs/<family>.ts` maps each to its
language-reference anchor. There is no hand-kept table to keep in sync;
`test/system/diagnostic-catalog.test.ts` fails on an uncataloged code, an
orphaned entry, or an entry filed under the wrong family.

Code spelling is lower-case throughout (`loom.findall-no-page`).

## Mechanics

A validator takes its text from the catalog with `diagMessage(key, params)`
and attaches the bare `code` on the Langium `ValidationAcceptor` call:

```ts
accept(
  "error",
  diagMessage("loom.bare-aggregate-in-type", { name }),
  { node, property: "type", code: "loom.bare-aggregate-in-type" },
);
```

An inline message literal fails `test/system/diagnostic-catalog.test.ts`,
as does a code that does not match `loom.<area>-<symptom>`.

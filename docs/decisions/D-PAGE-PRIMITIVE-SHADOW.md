# D-PAGE-PRIMITIVE-SHADOW — a `component` may not take a walker-primitive name; a `valueobject` may

**Status:** applied — the proposed default took effect 2026-09-24 (merged to `main` 2026-09-22 in #2970; no override recorded by 2026-09-28; flipped by Wave C5 packet 5.0).
Raised by wave C2 packet 2g (§7.1, "does a user declaration shadow a page
primitive in a ui body?") and settled by packet 2k on measurement.

**Question.** The page-body vocabulary (`Text`, `Card`, `Alert`, `Table`,
`Money`, `Badge`, …) is a closed set of ~55 names, and nothing stopped a user
declaration from taking one. Which wins — the primitive or the declaration —
and should the collision be refused?

**What was actually measured**, on `main` at `5049b6fea`, one generation per
case:

| collision | what happens |
|---|---|
| `component Alert(msg: string) { body: Heading { msg, level: 3 } }` + `body: Stack { Alert("hi") } }` | `0 error(s), 0 warning(s)`. `src/components/Alert.tsx` is written, AND the call site emits the PACK's primitive — `import { Alert, … } from "@mantine/core"` / `<Alert color="red" variant="light">{t("page.Home.alert.sx4lga", "hi")}</Alert>`. The author's `Heading` appears nowhere in the project. |
| `valueobject Money { amount: decimal  currency: string }` + `body: … Money { 10, "dropped" }` | the PRIMITIVE wins and its own arity gate fires — `loom.page-primitive-extra-children`. The value object does not capture the name. |

So the two halves are not the same problem, and the blanket rule ("no user
declaration may share a primitive name") is wrong in one direction.

**Decision.** **Refuse the COMPONENT collision; admit the value-object /
enum / domain-service one.**

* A `component` (walked or `extern`) is reached by the page-body dispatcher
  under exactly the name the primitive is, and the primitive wins. The
  declaration is therefore dead on arrival: emitted, never rendered, with no
  diagnostic. That is a silent-codegen defect, and it is the SAME defect
  `loom.extern-function-shadows-stdlib` has refused since it was written —
  its own comment gives the reason ("the body dispatcher would route the call
  to the primitive, silently ignoring the user's module"). The component arm
  was simply missing. New code: **`loom.component-shadows-stdlib`**, an error
  at phase ④ (`src/language/validators/ui.ts`, `checkComponent`).
* A `valueobject` / `enum` / `domainService` is not reached by the dispatcher
  at all, so it shadows nothing — and refusing it would reject
  `web/src/examples/sales-system.ddd`, which declares `valueobject Money`
  beside pages that use the `Money` primitive. A gate there would be a
  regression dressed as a fix. (Corpus scan at decision time: zero `.ddd` in
  `examples/`, `web/src/examples/`, `journey/` or `test/` declares a
  *component* named after a primitive, so the new gate breaks nothing.)

**Consequence for the ambient decl index.** 2g narrowed `indexAggregatesDeep`
(`src/ir/lower/lower.ts`) to aggregates ONLY, explicitly deferring the
value-object / enum / domain-service halves to this decision because widening
them looked like it would shadow the primitives. The measurement above says it
does not: the primitive still wins the call and its arity gate still fires, on
the un-narrowed `indexMembers` path that already indexes value objects and
enums through `contexts`. The halves may therefore be widened when a row needs
them; this decision removes the blocker, and packet 2k did not widen them
because no row on its tree needed it.

**Affects.** `src/language/validators/ui.ts` (`checkComponent`);
`src/diagnostics/messages.ts` + `code-docs.ts`;
`test/language/validation/component-shadows-primitive.test.ts` (mutation-proved:
removing the gate fails 4 of 7 with `expected [] to include
'loom.component-shadows-stdlib'`); [`docs/new-plan/T1-ui-frontend.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/new-plan/T1-ui-frontend.md) M-T1.20.

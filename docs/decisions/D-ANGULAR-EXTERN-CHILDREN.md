# D-ANGULAR-EXTERN-CHILDREN — children into an Angular component: built for the walked flavour, a language question for `extern`

**Status:** applied — the proposed default took effect 2026-09-16 (merged to `main` 2026-09-14 in #2933; no override recorded by 2026-09-28; flipped by Wave C5 packet 5.0).
Raised by wave C2 packet 2h, which was asked to close
`loom.component-children-unsupported`.

**Question.** A user component invoked with CHILDREN — the extra positional
argument every JSX-family frontend renders between the open and close tags —
was dropped on Angular, because Angular has no PascalCase component tag and the
call site went through `<ng-container [ngComponentOutlet]="X" …>`, which sets
INPUTS and has no content-projection channel. Is the whole row a gap to drain?

**Options.** (a) drain it for both component flavours; (b) drain the walked
flavour and re-class the remainder; (c) refuse permanently and rename the code
out of the `-unsupported` suffix.

**Decision.** **(b), and the split is not a compromise — the two halves are
different KINDS of problem.**

A **walked** component is one Loom emits: `components-emit.ts` writes the class
and stamps `@Component({ selector: "app-panel" })`, and its body's `Slot { }`
already rendered `<ng-content></ng-content>`. Loom therefore knows a tag for
it, and the call site can be one — `<app-panel [label]='"a"'>…children…
</app-panel>`, with the class in the page's standalone `imports: []` instead of
`NgComponentOutlet`. That is now what is emitted (`renderAngularUserComponent`,
`src/generator/angular/walker/angular-target.ts`), so the drop is GONE for this
flavour rather than merely named. It was a gap; it drained.

An **extern** component is a hand-written Angular class reached through a
re-export shim, and its `@Component({ selector })` is the author's. Loom has no
tag to spell, so it must keep the outlet, and the outlet cannot project content
from a template at all (`ngComponentOutletContent` takes pre-built DOM nodes —
TS-side only). No amount of Angular emitter work closes that: the missing thing
is INFORMATION, and the only place it can come from is the `.ddd`. Addressing
an extern component by tag needs a surface — a selector clause on `extern from`
— which is a grammar change plus a lowering field plus a validator rule, on a
declaration every OTHER frontend addresses by imported symbol rather than by
tag. That is a language ruling, not a per-target TODO, which is what makes the
remainder a `scope` row rather than a gap left half-drained.

NOT (c): the shape is expressible the moment the surface exists, and the
diagnostic keeps naming a real loss in the meantime.

**Successor.** **M-T1.33** ([`docs/new-plan/T1-ui-frontend.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/new-plan/T1-ui-frontend.md)) — the extern
selector clause, its validator rule, and the gate's deletion.

**Consequences.** `loom.component-children-unsupported` is `kind: "scope"`,
owner M-T1.33 (`MAX_OPEN_GAPS` 24 → 23). The gate narrowed to `c.extern` in
`src/ir/util/component-children.ts`, so a walked component with children no
longer warns; its message now names the extern flavour and points at dropping
`extern from` as the in-language remedy. The degradation comment at the call
site (#2734) survives on the outlet arm only.

**Sources.** `src/generator/angular/walker/angular-target.ts`
(`renderAngularUserComponent`, `angularTargetFor`),
`src/generator/angular/walker/page-shell.ts` (the two registrations),
`src/ir/util/component-children.ts`, `docs/extern.md`,
[`docs/new-plan/waves/handoffs/wave-c2-2h-angular.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/new-plan/waves/handoffs/wave-c2-2h-angular.md).

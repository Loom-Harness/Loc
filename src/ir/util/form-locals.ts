// Which page-local binding does a form primitive claim on each JS frontend —
// and where do two forms on one page claim the SAME one.
//
// Every JS-family frontend emits a form as page-scope `const`s spliced above
// the body (the mutation hook plus the form handle: `const create =
// useCreateItem(); const { register, handleSubmit, … } = useForm(...)`), and
// those names come out of the design pack's `form-of-decls` / `form-op-decls`
// templates.  Two forms on one page therefore emit two declarations, and
// whether that is FINE depends entirely on how the frontend names them:
//
//   react  / svelte — bare `create`, `form`, `register`, `handleSubmit`.  Two
//                     CreateForms on one page redeclare all of them, whatever
//                     aggregates they are over: TS2300 / a Svelte compile
//                     error.  Two OperationForms collide when the OP NAMES
//                     match (`const rename = …` twice), across aggregates too.
//   vue             — the same bare names, but the shell DEDUPES the decl
//                     strings, so it COMPILES and the second form silently
//                     reuses the first form's mutation and schema: a
//                     `CreateForm { of: Note }` posts an `Item`, announces
//                     "Note created" and navigates to `/notes/…`.  The worst
//                     of the four, because nothing fails.
//   angular         — NOT COVERED, because it is FIXED.  Its locals were
//                     already aggregate-scoped (`itemCreate`, `itemForm`,
//                     `renameItem`), leaving only the same-aggregate+op case,
//                     and #2734 closed that too: the second form takes an
//                     ORDINAL SUFFIX (`itemCreate2`, `onSubmitItem2`,
//                     `itemForm2`), so every declaration appears exactly once.
//                     Two forms of any shape now emit correctly on angular.
//
// Angular is therefore the existence proof AND the reference implementation:
// generalising the fix means threading the same per-form ordinal through the
// ~68 react/vue/svelte pack templates that hardcode `create` / `register` /
// `handleSubmit` / `errors`.  Until that lands, this module is the single place
// that knows the rule, so the gate (`loom.page-form-locals-unsupported`) and
// the eventual fix disagree in exactly one file.
//
// A NOTE ON WHY ANGULAR WAS EVER IN THE SET.  This gate was written against a
// `main` where angular still collided on same-aggregate+op, and it modelled
// that precisely.  #2734 then fixed it.  A gate that keeps refusing a shape the
// emitter has learned to handle is not a conservative gate — it is a FALSE
// refusal, and it hides the fix: main's own
// `gives the second same-aggregate form its own class members` test could not
// even reach generation while angular stayed listed here.  That is the ratchet
// working in the direction it is supposed to: a drained arm deletes itself.
//
// A HOLE THIS GATE HAD FOR ITS FIRST LIFE: `WorkflowForm` was not modelled at
// all, and the rule keyed on the MUTATION name alone.  `CreateForm` +
// `WorkflowForm` name their mutations `create` and `run`, which genuinely do
// not collide — so the pair walked straight past, and then both templates
// emitted `const form = useForm(…)` into the same scope.  Measured on `main`:
// `form` (and `outcome`) declared twice in the emitted page on react, vue AND
// svelte, with `0 error(s), 0 warning(s)` from `ddd parse`.  Two workflow
// forms collide the same way and on `run` besides, whatever workflows they
// run.  The fix is `claimedLocals` below returning a LIST: a form claims its
// mutation handle AND the form handle, and they collide on different axes.
// Angular is clean here too, and was verified rather than assumed
// (`thingCreate`/`thingForm` vs `makeThingRun`/`makeThingForm`).
//
// Shapes deliberately NOT flagged, because they were probed and are CLEAN on
// all three covered frontends: `CreateForm` + `OperationForm` on one page,
// two `OperationForm`s over DIFFERENT ops, and `DestroyForm` beside either —
// an operation form's declarations go through the pack's `form-op-module`
// template into their own scope, and a destroy form claims no page-scope
// binding at all.  A gate that fired on those would be a false refusal.
//
// The second of those was NOT clean on svelte until M-T1.34 (#2864 T5), and the
// hole is worth recording because it is the shape this module reasons about
// from one axis only.  The rule above keys on the names a form claims for its
// own MUTATION and HANDLE (`create`, `rename`, `form`) — differently-named ops
// never collide there.  But a form also claims one binding per `X id` param it
// renders as a picker (`const __locations = useAllLocations()`), and THAT name
// comes from the TARGET aggregate, not from the op: two differently-named ops
// each taking a `Location id` claimed `__locations` twice.  Svelte was the only
// frontend it reached — react scopes each form to its own component, vue
// deduped these lines already — and it is now deduped at svelte's page shell
// (`src/generator/svelte/walker/page-shell.ts`), so the paragraph above holds
// again.  A picker binding is safe to SHARE where a mutation handle is not:
// every form wants the same list of options off the same query.

import type { ExprIR, UiIR } from "../types/loom-ir.js";
import { walkExprDeep } from "./walk.js";

/** The frontends this rule applies to at all.  Feliz / Flutter / HEEx build
 *  their forms through different machinery (Elmish messages, Riverpod
 *  notifiers, `handle_event` clauses) and are NOT covered here — a gate that
 *  named them would be a refusal nobody verified. */
export const FORM_LOCAL_FRAMEWORKS = new Set(["react", "vue", "svelte"]);

/** One form primitive found in a body, reduced to the identity that decides
 *  collisions.  `kind` separates the naming families — an operation form never
 *  claims the names a create or workflow form does. */
interface FormSite {
  kind: "create" | "operation" | "workflow";
  /** The `of:` aggregate, when the call spells one. */
  agg: string | undefined;
  /** The operation name (`kind: "operation"`) or the workflow name
   *  (`kind: "workflow"`).  The workflow name is carried for the LABEL only —
   *  react/vue/svelte spell the mutation `run` flat, so two workflow forms
   *  collide however differently their workflows are named. */
  op: string | undefined;
  /** Source spelling, for the diagnostic. */
  label: string;
}

/** The named argument `name` of a primitive call, if present. */
function namedArgOf(call: Extract<ExprIR, { kind: "call" }>, name: string): ExprIR | undefined {
  const names = call.argNames;
  if (!names) return undefined;
  const i = names.indexOf(name);
  return i >= 0 ? call.args[i] : undefined;
}

/** A bare `ref`'s name — how `of: Item` / `op: rename` lower (both are
 *  `refKind: "unknown"` refs at this point; the walker resolves them). */
function refName(e: ExprIR | undefined): string | undefined {
  return e?.kind === "ref" ? e.name : undefined;
}

/** Every form primitive in a body, in source order. */
function formSites(body: ExprIR | undefined): FormSite[] {
  const out: FormSite[] = [];
  walkExprDeep(body, (e) => {
    if (e.kind !== "call") return;
    if (e.name === "CreateForm") {
      const agg = refName(namedArgOf(e, "of") ?? e.args[0]);
      out.push({
        kind: "create",
        agg,
        op: undefined,
        label: `CreateForm${agg ? ` { of: ${agg} }` : ""}`,
      });
      return;
    }
    if (e.name === "WorkflowForm") {
      const wf = refName(namedArgOf(e, "runs") ?? e.args[0]);
      out.push({
        kind: "workflow",
        agg: undefined,
        op: wf,
        label: `WorkflowForm${wf ? ` { runs: ${wf} }` : ""}`,
      });
      return;
    }
    if (e.name === "OperationForm") {
      const ofArg = namedArgOf(e, "of");
      const opArg = namedArgOf(e, "op");
      if (ofArg || opArg) {
        const agg = refName(ofArg);
        const op = refName(opArg);
        out.push({
          kind: "operation",
          agg,
          op,
          label: `OperationForm { of: ${agg ?? "?"}, op: ${op ?? "?"} }`,
        });
        return;
      }
      // The `<instance>.<op>` spelling — the aggregate is not named, so the op
      // alone is the identity (which is exactly what react/svelte name it by).
      const first = e.args[0];
      if (first?.kind === "member") {
        out.push({
          kind: "operation",
          agg: undefined,
          op: first.member,
          label: `OperationForm { …${first.member} }`,
        });
      }
    }
  });
  return out;
}

/** Every page-local binding a form site claims.
 *
 *  A LIST, not one key, because a form claims two different kinds of binding
 *  and they collide on different axes:
 *
 *    - its MUTATION handle, named after the form's role (`create`, `run`) or
 *      its operation (`rename`);
 *    - the FORM HANDLE itself (`const form = useForm(…)` / the destructured
 *      `{ register, handleSubmit, setError, control, formState: { errors } }`),
 *      which is spelled `form` on every create and workflow form there is.
 *
 *  Keying on the mutation alone is why `CreateForm` + `WorkflowForm` walked
 *  past this gate: their mutations are `create` and `run`, which genuinely do
 *  not collide — and then both templates emit `const form = useForm(…)` into
 *  the same scope, and the page does not compile.  Measured on react, vue and
 *  svelte: `form` (and `outcome`) declared twice in the emitted page.
 *
 *  An OPERATION form claims no `form`: its declarations go through the pack's
 *  `form-op-module` template into their own scope, which is why `CreateForm` +
 *  `OperationForm` is clean and must stay unflagged.
 *
 *  No `framework` parameter: all three covered frontends name these locals the
 *  SAME way — bare, with no aggregate in the name — so the keys are uniform.
 *  The function used to branch on an aggregate-scoped set that held only
 *  `angular`, and angular is now out of scope entirely (it emits correctly). */
function claimedLocals(site: FormSite): string[] {
  switch (site.kind) {
    // `const create = useCreate<Agg>()` — spelled flat, so ALL create forms on
    // a page share it, whatever aggregates they are over.
    case "create":
      return ["create", "form"];
    // `const run = use<Wf>Workflow()` — likewise flat, so two workflow forms
    // collide even when they run DIFFERENT workflows (verified: `run` and
    // `form` each declared twice for `makeThing` + `otherThing`).
    case "workflow":
      return ["run", "form"];
    // Keyed by the op name alone, which is all these three put in the binding.
    case "operation":
      return [`op:${site.op ?? "?"}`];
  }
}

/** The form sites in one body that would emit a COLLIDING page-local, grouped
 *  by the local they collide on.  Empty when the body is fine. */
export function collidingFormLocals(
  body: ExprIR | undefined,
): { local: string; labels: string[] }[] {
  const byKey = new Map<string, string[]>();
  for (const site of formSites(body)) {
    for (const key of claimedLocals(site)) {
      const bucket = byKey.get(key);
      if (bucket) bucket.push(site.label);
      else byKey.set(key, [site.label]);
    }
  }
  return (
    [...byKey]
      .filter(([, labels]) => labels.length > 1)
      // One report per PAIR of forms, not one per binding they share: two
      // create forms collide on `create` AND on `form`, and saying so twice
      // reads as two problems.  The mutation key is the more specific of the
      // two, so a `form`-only collision (create + workflow) still reports.
      .filter(([local, labels], _i, all) =>
        local === "form" ? !all.some(([k, ls]) => k !== "form" && sameLabels(ls, labels)) : true,
      )
      .map(([local, labels]) => ({ local, labels }))
  );
}

/** Two collision buckets holding the same form labels are the same problem
 *  reported against two of its bindings. */
function sameLabels(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Every page/component of a ui whose forms would collide, labelled for a
 *  diagnostic.  Components are scanned too — a form moved into a component
 *  collides inside THAT component's own shell for the same reason.
 *
 *  Takes no `framework`: the naming rule is uniform across the three covered
 *  frontends (see `localKey`), so the framework only decides WHETHER to run
 *  this at all, which is the caller's `FORM_LOCAL_FRAMEWORKS` test. */
export function formLocalCollisionHosts(
  ui: UiIR,
): { what: string; local: string; labels: string[] }[] {
  const out: { what: string; local: string; labels: string[] }[] = [];
  for (const p of ui.pages) {
    for (const c of collidingFormLocals(p.body)) {
      out.push({ what: `page '${p.name}'`, ...c });
    }
  }
  for (const c of ui.components) {
    for (const hit of collidingFormLocals(c.body)) {
      out.push({ what: `component '${c.name}'`, ...hit });
    }
  }
  return out;
}

// -------------------------------------------------------------------------
// Lazy-loaded user-component support checks (Feliz / Angular component
// deferral) — `loom.user-component-unsupported` and its per-target
// deferral analyses.  Split out of ui-checks.ts by packet 2.6 (wave-2) —
// mechanical move, no logic change.
// -------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import { pagedReturn } from "../../stdlib/generics.js";
import type { AggregateIR, ComponentIR, ExprIR, FindIR, UiIR } from "../../types/loom-ir.js";
import { walkExprDeep } from "../../util/walk.js";
import type { LoomDiagnostic } from "./diagnostic.js";

/** One deferral: what the emitter filtered on, in the emitter's own terms. */

interface ComponentDeferral {
  reason: string;
  /** The emitter site this arm mirrors — quoted in the diagnostic so the next
   *  reader can check the arm against the filter rather than trusting it. */
  emitter: string;
}

/** Lookups the deferral arms need — the ui's api handles plus the domain
 *  vocabulary the api-read patterns resolve against. */

interface DeferCtx {
  aggByName: ReadonlyMap<string, AggregateIR>;
  apiParamNames: ReadonlySet<string>;
  aggNames: ReadonlySet<string>;
  /** aggregate name → its repository's user finds, by name.  A read that
   *  resolves to one is hoisted as a REACTIVE query on Angular (its args are
   *  re-read lazily), which is what exempts it from the input-fed-read arm. */
  findsByAggregate: ReadonlyMap<string, ReadonlyMap<string, FindIR>>;
}

/** The api read a walked expression denotes, mirroring the walker's
 *  `tryDetectApiHook` patterns A/B (`<handle>.<Agg>.<op>`) and D/E
 *  (`<Agg>.<op>`, no handle) — the aggregate-rooted ones, which are the only
 *  patterns the arms below key on.  Returns `undefined` for anything else. */

function detectAggregateRead(
  e: ExprIR,
  ctx: DeferCtx,
): { aggregate: string; operation: string; args: readonly ExprIR[] } | undefined {
  if (e.kind === "member" && e.receiver.kind === "member") {
    const inner = e.receiver;
    if (inner.receiver.kind === "ref" && ctx.apiParamNames.has(inner.receiver.name)) {
      return { aggregate: inner.member, operation: e.member, args: [] };
    }
  }
  if (e.kind === "method-call" && e.receiver.kind === "member") {
    const inner = e.receiver;
    if (inner.receiver.kind === "ref" && ctx.apiParamNames.has(inner.receiver.name)) {
      return { aggregate: inner.member, operation: e.member, args: e.args };
    }
  }
  if (e.kind === "member" && e.receiver.kind === "ref" && ctx.aggNames.has(e.receiver.name)) {
    return { aggregate: e.receiver.name, operation: e.member, args: [] };
  }
  if (e.kind === "method-call" && e.receiver.kind === "ref" && ctx.aggNames.has(e.receiver.name)) {
    return { aggregate: e.receiver.name, operation: e.member, args: e.args };
  }
  return undefined;
}

/** The walker's standard aggregate operations (`walker-core.ts`
 *  `STANDARD_AGG_OPS`) — the ops whose hook args are NOT rewritten into a
 *  reactive query bag. */

const STANDARD_AGG_OPS: ReadonlySet<string> = new Set([
  "all",
  "byId",
  "create",
  "update",
  "delete",
]);

/** True when a read is hoisted as a REACTIVE query — a user `find`, or a
 *  paged `all`, whose rendered args become a query bag the query re-reads
 *  (`adjustFindHookArgs` in `src/generator/_walker/walker-core.ts`).  Such a
 *  read is exempt from the Angular input-fed-read filter: its args are wrapped
 *  in a `() => (…)`, so an `@Input()` is read lazily rather than in the
 *  constructor. */

function isReactiveQueryRead(aggregate: string, operation: string, ctx: DeferCtx): boolean {
  const find = ctx.findsByAggregate.get(aggregate)?.get(operation);
  if (!find) return false;
  const paged = pagedReturn(find.returnType) !== null;
  return !STANDARD_AGG_OPS.has(operation) || paged;
}

/** Names read by an expression — every `ref`, at any depth.  Used to ask
 *  whether a read's ARGUMENT reaches for a component parameter, which is what
 *  the Angular filter asks of the RENDERED argument text. */

function refNamesIn(e: ExprIR): Set<string> {
  const out = new Set<string>();
  walkExprDeep(e, (x) => {
    if (x.kind === "ref") out.add(x.name);
  });
  return out;
}

/** True when the expression tree reaches for the magic route `id`
 *  (`{ kind: "id" }` — what `walker-core.ts` sets `ctx.usesRouteId` on). */

function readsRouteId(e: ExprIR | undefined): boolean {
  let found = false;
  walkExprDeep(e, (x) => {
    if (x.kind === "id") found = true;
  });
  return found;
}

/** Params the Feliz / Angular props layer has no spelling for. */

function paramDeferrals(c: ComponentIR, framework: string): ComponentDeferral[] {
  const out: ComponentDeferral[] = [];
  for (const p of c.params) {
    const inner = p.type.kind === "optional" ? p.type.inner : p.type;
    if (inner.kind === "slot") {
      out.push({
        reason: `parameter '${p.name}' is a \`slot\``,
        emitter:
          framework === "feliz"
            ? "src/generator/feliz/component-emit.ts `propType` — a slot has no props-record spelling"
            : "src/generator/angular/components-emit.ts `hasSlotOrActionParam` — `ngComponentOutletInputs` sets INPUTS and has no content-projection channel",
      });
    } else if (inner.kind === "action") {
      out.push({
        reason: `parameter '${p.name}' is an \`action\` callback`,
        emitter:
          framework === "feliz"
            ? "src/generator/feliz/component-emit.ts `propType` — an action has no props-record spelling"
            : "src/generator/angular/components-emit.ts `hasSlotOrActionParam` — a callback through the inputs object loses `this`",
      });
    } else if (framework === "feliz" && p.type.kind === "optional") {
      out.push({
        reason: `parameter '${p.name}' is optional`,
        emitter:
          "src/generator/feliz/component-emit.ts `propType` — an F# anonymous record is EXACT, so a call site omitting the field would not typecheck",
      });
    }
  }
  return out;
}

/** The Feliz filters, in `component-emit.ts` order: the `isCandidate` param /
 *  derived gates, then the post-walk `renderOne` gates. */

function felizDeferrals(c: ComponentIR, ctx: DeferCtx): ComponentDeferral[] {
  const out = [...paramDeferrals(c, "feliz")];
  // `isCandidate` → `derivedNeedsPageScope`: the route `id` is bound by a PAGE
  // view fn, not by a component function.
  for (const d of c.derived) {
    if (readsRouteId(d.expr)) {
      out.push({
        reason: `\`derived ${d.name}\` reads the route \`id\`, which only a PAGE view binds`,
        emitter: "src/generator/feliz/component-emit.ts `derivedNeedsPageScope`",
      });
    }
  }
  // `renderOne` → `result.usesRouteId`.  Three body shapes set it: an explicit
  // `id`, and the two primitives the Feliz target forks onto a dispatch that
  // carries the route id (`felizTarget.renderAction` / `renderDestroyForm` both
  // set `ctx.usesRouteId = true` before returning their F#).
  const routeIdCauses: string[] = [];
  walkExprDeep(c.body, (e) => {
    if (e.kind === "id") routeIdCauses.push("reads the route `id`");
    if (e.kind !== "call") return;
    if (e.name === "DestroyForm") {
      const ofIdx = (e.argNames ?? []).indexOf("of");
      const ofArg = ofIdx >= 0 ? e.args[ofIdx] : undefined;
      if (ofArg?.kind === "ref") {
        routeIdCauses.push("renders `DestroyForm`, which deletes the record at the route `id`");
      }
    }
    if (e.name === "Action") {
      // `felizTarget.renderAction` resolves the receiver through the walk's
      // aggregate-typed params and requires a PARAMETERLESS public op; anything
      // else renders a comment instead (and never touches `usesRouteId`).
      const argNames = e.argNames ?? [];
      const opRef = (e.args ?? []).find((_, i) => !argNames[i]);
      if (opRef?.kind !== "member" || opRef.receiver.kind !== "ref") return;
      const paramType = c.params.find(
        (p) => p.name === (opRef.receiver as { name: string }).name,
      )?.type;
      const aggName = paramType?.kind === "entity" ? paramType.name : undefined;
      const agg = aggName ? ctx.aggByName.get(aggName) : undefined;
      const op = agg?.operations.find(
        (o) => o.name === opRef.member && o.visibility === "public" && o.params.length === 0,
      );
      if (op) {
        routeIdCauses.push(
          `renders \`Action { ${opRef.receiver.name}.${opRef.member} }\`, which dispatches with the route \`id\``,
        );
      }
    }
  });
  for (const cause of [...new Set(routeIdCauses)]) {
    out.push({
      reason: `its body ${cause} — a component function has no route of its own`,
      emitter:
        "src/generator/feliz/component-emit.ts `renderOne` (`result.usesRouteId`); the route `id` is bound by a page view fn",
    });
  }
  // `renderOne` → `(result.usedStores?.size ?? 0) > 0`.
  const stores = new Set<string>();
  walkExprDeep(c.body, (e) => {
    if (e.kind === "ref" && e.refKind === "store-field" && e.storeName) stores.add(e.storeName);
    if (e.kind === "call" && e.storeAction) stores.add(e.storeAction.store);
    if (e.kind === "action-ref" && e.storeName) stores.add(e.storeName);
  });
  for (const store of [...stores].sort()) {
    out.push({
      reason: `its body reads store '${store}'`,
      emitter: "src/generator/feliz/component-emit.ts `renderOne` (`result.usedStores`)",
    });
  }
  // `renderOne` → `needsMvuScope`: a `byId` read renders `model.<Agg>ById`, a
  // Model field `collectComponentReads` deliberately does NOT declare (its
  // fetch is fired by `pageCmd` on ROUTE entry, keyed to the hosting page's
  // `Page` case — which a component has none of).
  const byIdAggs = new Set<string>();
  walkExprDeep(c.body, (e) => {
    const read = detectAggregateRead(e, ctx);
    if (read?.operation === "byId") byIdAggs.add(read.aggregate);
  });
  for (const agg of [...byIdAggs].sort()) {
    out.push({
      reason: `its body issues a \`${agg}.byId(…)\` read, whose fetch a PAGE fires on route entry`,
      emitter:
        "src/generator/feliz/wire.ts `collectBodyReads` (a component passes no `pageCase`, so no Model field is declared) + `component-emit.ts` `needsMvuScope`",
    });
  }
  return out;
}

/** The Angular filters, in `components-emit.ts` order. */

function angularDeferrals(c: ComponentIR, ctx: DeferCtx): ComponentDeferral[] {
  const out = [...paramDeferrals(c, "angular")];
  // `renderOne` → the input-fed-read guard.  The page shell hoists an api read
  // as a class FIELD initializer, which runs in the constructor — before
  // Angular has set any `@Input()` — so the read would fire on `undefined`.
  // A REACTIVE query is exempt: a user `find`'s args are wrapped in a
  // `() => (…)` the query re-reads, so the input is read lazily.
  const inputNames = new Set(c.params.map((p) => p.name));
  const seen = new Set<string>();
  walkExprDeep(c.body, (e) => {
    const read = detectAggregateRead(e, ctx);
    if (!read || read.args.length === 0) return;
    if (isReactiveQueryRead(read.aggregate, read.operation, ctx)) return;
    const fed = read.args.flatMap((a) => [...refNamesIn(a)]).filter((n) => inputNames.has(n));
    if (fed.length === 0) return;
    const key = `${read.aggregate}.${read.operation}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      reason:
        `its body issues a \`${key}(…)\` read whose argument reads the \`@Input()\` ` +
        `'${fed[0]}' — the hoisted read runs in the constructor, before Angular sets inputs`,
      emitter: "src/generator/angular/components-emit.ts `renderOne` (the `readsAnInput` guard)",
    });
  });
  return out;
}

/** True when the expression tree reads `currentUser.<claim>` — the shape
 *  `walker-core.ts` sets `ctx.usesCurrentUser` on (a MEMBER access off a
 *  `current-user` ref, on a target that defines `renderCurrentUserAccess`;
 *  Flutter does). */
function readsCurrentUser(e: ExprIR | undefined): boolean {
  let found = false;
  walkExprDeep(e, (x) => {
    if (x.kind === "member" && x.receiver.kind === "ref" && x.receiver.refKind === "current-user")
      found = true;
  });
  return found;
}

/** True when the expression tree names the session AT ALL — a bare
 *  `current-user` ref, member access or not.  This is what
 *  `component-emit.ts`'s `derivedNeedsShell` tests on the DERIVED side (it
 *  matches the ref, not the access), so the derived arm mirrors it exactly
 *  rather than borrowing the body arm's narrower member shape. */
function namesCurrentUser(e: ExprIR | undefined): boolean {
  let found = false;
  walkExprDeep(e, (x) => {
    if (x.kind === "ref" && x.refKind === "current-user") found = true;
  });
  return found;
}

/** The aggregate a form primitive's `of:` arg names, when it resolves — the
 *  same lookup `flutterTarget`'s form seams do before they bind `id:`. */
function formOfArg(e: ExprIR, ctx: DeferCtx): AggregateIR | undefined {
  if (e.kind !== "call") return undefined;
  const names = e.argNames ?? [];
  const idx = names.indexOf("of");
  const ofArg = idx >= 0 ? e.args[idx] : undefined;
  return ofArg?.kind === "ref" ? ctx.aggByName.get(ofArg.name) : undefined;
}

/** The Flutter filters, in `component-emit.ts` order:
 *  `candidates` → `derivedNeedsShell`, then `emittableComponentParams`'s
 *  `usesStores` / `needsPageShell` / `isReadConsumer` guards.
 *
 *  Every arm was MEASURED on this HEAD (generate the shape, confirm the
 *  `unknown layout component` sentinel), and the negative shapes were measured
 *  too: Flutter has NO param filter at all — a `slot`, an `action(T)` and an
 *  optional param each emit fine, and so does an api read whose argument feeds
 *  on a component param (both the Feliz `propType` and the Angular
 *  input-fed-read filters are Flutter non-issues). */
function flutterDeferrals(c: ComponentIR, ctx: DeferCtx): ComponentDeferral[] {
  const out: ComponentDeferral[] = [];

  // `candidates` → `derivedNeedsShell`: a `derived` whose expression names a
  // binding only a PAGE shell declares.  All three legs reproduce on Flutter
  // (unlike Feliz, whose `currentUser` leg does not).
  for (const d of c.derived) {
    const causes: string[] = [];
    if (readsRouteId(d.expr)) causes.push("the route `id`");
    const stores = new Set<string>();
    walkExprDeep(d.expr, (e) => {
      if (e.kind === "ref" && e.refKind === "store-field" && e.storeName) stores.add(e.storeName);
    });
    for (const s of [...stores].sort()) causes.push(`store '${s}'`);
    if (namesCurrentUser(d.expr)) causes.push("the session `currentUser`");
    for (const cause of causes) {
      out.push({
        reason: `\`derived ${d.name}\` reads ${cause}, which only a PAGE shell binds`,
        emitter: "src/generator/flutter/component-emit.ts `derivedNeedsShell`",
      });
    }
  }

  // `emittableComponentParams` → `r.usesStores`.  A store is a Riverpod
  // provider, so reaching it needs the `WidgetRef` only the page path carries.
  const stores = new Set<string>();
  walkExprDeep(c.body, (e) => {
    if (e.kind === "ref" && e.refKind === "store-field" && e.storeName) stores.add(e.storeName);
    if (e.kind === "call" && e.storeAction) stores.add(e.storeAction.store);
    if (e.kind === "action-ref" && e.storeName) stores.add(e.storeName);
  });
  for (const store of [...stores].sort()) {
    out.push({
      reason: `its body reads store '${store}'`,
      emitter: "src/generator/flutter/component-emit.ts `emittableComponentParams` (`usesStores`)",
    });
  }

  // `emittableComponentParams` → `needsPageShell` (`usesRouteId`).  FOUR body
  // shapes set it on Flutter: an explicit `id` (which a `byId(id)` read carries
  // too), and the three form primitives whose emitted Dart addresses the row by
  // the page's route id (`flutterTarget.renderOperationForm` /
  // `renderDestroyForm` / `renderModal`, each `ctx.usesRouteId = true`).
  // NOT a cause, measured: `Action { inst.op }` — the Flutter seam resolves its
  // receiver through `paramTypes`, which a component walk passes empty, so it
  // renders its own comment and never touches `usesRouteId`.
  const routeIdCauses: string[] = [];
  walkExprDeep(c.body, (e) => {
    if (e.kind === "id") routeIdCauses.push("reads the route `id`");
    if (e.kind !== "call") return;
    if (e.name === "DestroyForm" && formOfArg(e, ctx)) {
      routeIdCauses.push("renders `DestroyForm`, which deletes the record at the route `id`");
    }
    if (e.name === "OperationForm") {
      const agg = formOfArg(e, ctx);
      const names = e.argNames ?? [];
      const opIdx = names.indexOf("op");
      const opArg = opIdx >= 0 ? e.args[opIdx] : undefined;
      const op =
        opArg?.kind === "ref"
          ? agg?.operations.find((o) => o.name === opArg.name && o.visibility === "public")
          : undefined;
      if (agg && op) {
        routeIdCauses.push(
          `renders \`OperationForm { of: ${agg.name}, op: ${op.name} }\`, which posts to the record at the route \`id\``,
        );
      }
    }
  });
  for (const cause of [...new Set(routeIdCauses)]) {
    out.push({
      reason: `its body ${cause} — a component has no route of its own`,
      emitter:
        "src/generator/flutter/component-emit.ts `needsPageShell` (`usesRouteId`); the route `id` is bound by `index.ts`'s `routeArgBindings`, on a PAGE",
    });
  }

  // `emittableComponentParams` → `needsPageShell` (`usesCurrentUser`).
  if (readsCurrentUser(c.body)) {
    out.push({
      reason:
        "its body reads a `currentUser` claim — the session is bound by the page shell " +
        "(`final currentUser = ref.watch(sessionProvider).value!`), never by a component",
      emitter: "src/generator/flutter/component-emit.ts `needsPageShell` (`usesCurrentUser`)",
    });
  }

  // `isReadConsumer` → `!isStateful(c)`.  A component that BOTH carries `state
  // {}` and issues a read would need a `ConsumerStatefulWidget`; each half
  // alone emits fine (a `StatefulWidget`, a `ConsumerWidget`), which is what
  // makes the combination the arm.
  if (c.state.length > 0) {
    const reads = new Set<string>();
    walkExprDeep(c.body, (e) => {
      const read = detectAggregateRead(e, ctx);
      if (read) reads.add(`${read.aggregate}.${read.operation}`);
    });
    for (const read of [...reads].sort()) {
      out.push({
        reason:
          `it carries \`state {}\` AND issues a \`${read}(…)\` read — that pairing needs a ` +
          "`ConsumerStatefulWidget`, which the emitter does not build (either half alone is fine)",
        emitter: "src/generator/flutter/component-emit.ts `isReadConsumer` (`!isStateful`)",
      });
    }
  }

  return out;
}

/** Frontends that HAVE an extern-component hatch — a
 *  `component X(...) extern from "<path>"` is wired to the author's own module
 *  instead of being walked.  Measured on this tree (2026-09-11) by generating
 *  the same one-extern-component `.ddd` through each frontend:
 *
 *    react / vue / svelte / angular  `src/components/X.props.ts` + the import
 *    feliz                           `open Components.X` + `(X {| … |})`
 *    phoenixLiveView                 `<.live_component module={Components.X}
 *                                    id="x" score={3} />`
 *    flutter                         NOTHING — the call site renders a
 *                                    `const SizedBox.shrink()` carrying the
 *                                    walker's `loom:unrendered
 *                                    [loom.unknown-page-element] unknown layout
 *                                    component: X` give-up comment
 *
 *  Flutter is the one frontend with no hatch (M-T1.31 F17), and the walker's
 *  give-up is doubly misleading there: `unknown-page-element` reads as "you
 *  mistyped a name" for a component the ui DECLARES.  The set is kept rather
 *  than spelling `framework === "flutter"` so a new frontend that ports the
 *  hatch joins ONE list, and `COMPONENT_FILTERING_FRAMEWORKS` members outside
 *  it are gated automatically. */

const EXTERN_COMPONENT_FRAMEWORKS: ReadonlySet<string> = new Set([
  "react",
  "vue",
  "svelte",
  "angular",
  "feliz",
  // Listed though `checkUserComponentSupport` never runs for it today (HEEx is
  // not in `COMPONENT_FILTERING_FRAMEWORKS`): the set is the MEASURED record of
  // which frontends honour the hatch, and leaving the one that does out of it
  // would make a future reader re-measure.  `liveview-emit.ts` skips `c.extern`
  // with "their rendering is a hand-written LiveComponent embedded via
  // `<.live_component>`" — verified, not taken on trust.
  "phoenixLiveView",
]);

/** Per-framework deferral analysers — one per member of
 *  `COMPONENT_FILTERING_FRAMEWORKS`, and the two are pinned against each other
 *  so a framework cannot join the set without an analyser (or vice versa). */
export const COMPONENT_DEFERRALS: Record<
  string,
  (c: ComponentIR, ctx: DeferCtx) => ComponentDeferral[]
> = {
  feliz: felizDeferrals,
  angular: angularDeferrals,
  flutter: flutterDeferrals,
};

/** Raise one diagnostic per (component, deferred shape) for every ui rendered
 *  by a filtering frontend. */

export function checkUserComponentSupport(
  ui: UiIR,
  framework: string,
  dName: string,
  ctx: DeferCtx,
  diags: LoomDiagnostic[],
): void {
  for (const c of ui.components) {
    // An `extern` component is a hand-written shim the emitter wires — on every
    // frontend that HAS an extern hatch.  On one that does not (Flutter), the
    // declaration is dropped and every call site renders an empty box, so the
    // skip below would make the ONE frontend that cannot honour the hatch the
    // only one with no diagnostic (M-T1.31 F17).
    if (c.extern) {
      if (EXTERN_COMPONENT_FRAMEWORKS.has(framework)) continue;
      diags.push({
        severity: "error",
        code: "loom.user-component-deferred-target",
        message: diagMessage("loom.user-component-deferred-target", {
          name: c.name,
          uiName: ui.name,
          framework,
          dName,
          reason:
            "is an `extern` component, and this frontend has no extern-component hatch — " +
            "the declaration is dropped and every call site renders an empty box",
          emitter:
            "src/generator/flutter/component-emit.ts — no extern arm; the call site falls " +
            "through to `walker-core.ts`'s `unknown layout component` give-up",
        }),
        source: `component '${c.name}'`,
      });
      continue;
    }
    if (c.body === undefined) continue;
    const deferrals = COMPONENT_DEFERRALS[framework]?.(c, ctx) ?? [];
    for (const d of deferrals) {
      diags.push({
        severity: "error",
        code: "loom.user-component-deferred-target",
        message: diagMessage("loom.user-component-deferred-target", {
          name: c.name,
          uiName: ui.name,
          framework,
          dName,
          reason: d.reason,
          emitter: d.emitter,
        }),
        source: `component '${c.name}'`,
      });
    }
  }
}

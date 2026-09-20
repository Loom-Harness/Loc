// -------------------------------------------------------------------------
// E2E ROUTE-CONTRACT check — does the verb an e2e body calls resolve to a
// route THIS SAME COMPILATION emits?
//
// Its sibling `test-checks.ts` (`checkMagicCall`) answers a different, weaker
// question: does the verb NAME resolve to something in the model — an
// aggregate verb, a public operation, a declared find?  Every one of its arms
// is a lookup against the DECLARATION, and for the two lifecycle verbs it does
// not even do that:
//
//     if (method === "create" || method === "getById") return;
//
// So `api.products.create({…})` validated clean on an aggregate that declares
// no `create` and no `crudish` — and the backends, which gate the POST route
// on `emitsRestCreate`, mounted nothing.  One `generate system` run emitted a
// backend whose whole route list is
//
//     GET /api/products   GET /api/products/{id}   …
//
// and, from the same IR, an e2e suite that opens with
// `__post(`${base}/api/products`, …)`.  3 failed / 3 against the booted stack,
// `405 Method Not Allowed`, with `0 error(s), 0 warning(s)` at compile time —
// the "no drift between layers" claim failing INSIDE a single compilation.
//
// This check asks the routing question instead, and asks it of the one thing
// that knows the answer: `deriveAggregateOperations` (`src/ir/util/api-surface.ts`),
// the derivation all five backend route builders RENDER FROM.  A verb passes
// only when the derivation actually lists the route it lowers to, so the gate
// cannot drift from the emitters — if a backend stops mounting a route, the
// derivation stops listing it and this check starts refusing the call.
//
// The arms below mirror `renderApiCall` / `renderAggregateCall`
// (`src/system/e2e-render.ts`, `src/system/ui-e2e-render.ts`) IN ORDER, because
// what matters is the route the RENDERER will emit, not the most charitable
// route the model could serve.
// -------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import { lowerFirst, plural, snake } from "../../../util/naming.js";
import type {
  AggregateIR,
  ApiIR,
  BoundedContextIR,
  ExprIR,
  RepositoryIR,
  SubdomainIR,
  SystemIR,
  TestE2EIR,
  TestStmtIR,
} from "../../types/loom-ir.js";
import {
  type ApiOperationIR,
  apiStatusContext,
  deriveAggregateOperations,
} from "../../util/api-surface.js";
import {
  apisServedBy,
  type RoutedHandlerTarget,
  resolveRoutedHandler,
  routedHandlerNeedsUnsendableBody,
} from "../../util/routed-handler.js";
import { walkExprDeep, walkStmtExprsDeep } from "../../util/walk.js";
import { emitsCommandRoute } from "../../util/workflow-command-route.js";
import type { LoomDiagnostic } from "./diagnostic.js";

/** One `<magicId>.<slug>.<verb>(…)` call found in an e2e body. */
interface MagicCall {
  slug: string;
  verb: string;
  /** How many arguments it passes — the routed-handler arm checks it against
   *  the handler's declared param list, which binds POSITIONALLY. */
  argCount: number;
}

export function validateE2ERouteContract(
  test: TestE2EIR,
  sys: SystemIR,
  modulesByName: Map<string, SubdomainIR>,
  diags: LoomDiagnostic[],
): void {
  const target = sys.deployables.find((d) => d.name === test.deployableName);
  // An unresolved target is the cross-reference validator's problem (layer ④);
  // `test-checks.ts` skips it the same way rather than crashing here.
  if (!target) return;
  const contexts = collectContexts(target, modulesByName);
  // Explicit `route … -> <Ctx>.<Handler>` bindings live on the apis the target
  // deployable `serves:`, not on any aggregate — so they are the one route
  // class whose ground truth is the `ApiIR`, not `deriveAggregateOperations`.
  const apis = apisServedBy(target, sys.apis);
  const source = `${sys.name}/${test.name}`;
  // A ui-kind test binds BOTH magic receivers — its kind comes from the target
  // deployable's platform, not from what the body spells — so an api-shaped
  // body aimed at a UI-mounting deployable legitimately writes `api.…` and its
  // calls must be routed-checked too.
  for (const call of collectMagicCalls(test.statements, "api")) {
    checkApiVerb(call, contexts, apis, source, diags);
  }
  // The `ui.` half is scoped to a ui-kind test, mirroring `test-checks.ts`'s
  // single-`magicId` walk: only there does the body actually lower to page
  // objects, so only there is "drives no page object" the right complaint.
  if (test.kind === "ui") {
    for (const call of collectMagicCalls(test.statements, "ui")) {
      checkUiVerb(call, contexts, source, diags);
    }
  }
}

// ---------------------------------------------------------------------------
// The api surface — `api.<agg>.<verb>(…)` → an HTTP route
// ---------------------------------------------------------------------------

function checkApiVerb(
  call: MagicCall,
  contexts: BoundedContextIR[],
  apis: readonly ApiIR[],
  source: string,
  diags: LoomDiagnostic[],
): void {
  // `api.workflows.<name>` and `api.<projection>.{byKey,list}` route outside
  // `deriveAggregateOperations` (both are in its documented `notLifted` set),
  // so this check has no ground truth for them in the derivation.  The
  // workflow half DOES have one elsewhere: `emitsCommandRoute`
  // (`src/ir/util/workflow-command-route.ts`) is the predicate all five
  // backends gate the POST route on, so an EVENT-triggered workflow — a
  // reactor the in-process dispatcher starts — mounts nothing and a caller
  // must be refused here rather than emitting a POST that 404s.
  // `test-checks.ts` resolves the NAME; this asks the routing question.
  if (call.slug === "workflows") {
    const wf = contexts
      .flatMap((c) => c.workflows)
      .find((w) => lowerFirst(w.name) === call.verb || snake(w.name) === call.verb);
    // An unresolved name already raises `loom.e2e-unknown-workflow`.
    if (!wf || emitsCommandRoute(wf)) return;
    diags.push({
      severity: "error",
      code: "loom.e2e-unrouted-verb",
      source,
      message: diagMessage("loom.e2e-unrouted-verb#workflow", {
        verb: call.verb,
        workflow: wf.name,
        slug: snake(wf.name),
      }),
    });
    return;
  }
  if (findProjectionBySlug(call.slug, contexts)) return;
  const resolved = resolveAggregate(call.slug, contexts);
  if (!resolved) {
    // An explicit `route … -> <Ctx>.<Handler>` binding, addressed as
    // `api.<contextSlug>.<handlerName>(…)`.  Its ground truth is the api's own
    // `routes` list rather than `deriveAggregateOperations` (which covers
    // aggregate verbs only), so the contract question here is a different one:
    // does the CALL match the request shape the backends emit for that route?
    const routed = resolveRoutedHandler(call.slug, call.verb, contexts, apis);
    if (routed) checkRoutedHandlerCall(routed, call, source, diags);
    // Otherwise an unresolved slug already raises `loom.e2e-unknown-aggregate`;
    // a second diagnostic for the same call would just be noise.
    return;
  }
  const { agg, repo, ctx } = resolved;
  const ops = deriveAggregateOperations(agg, repo, apiStatusContext(ctx));
  if (apiRouteExists(call.verb, agg, repo, ops)) return;
  // Same fallback order as the renderer: every aggregate verb wins first, and
  // only then may a routed handler whose context slugs like the aggregate
  // answer the call.
  const routedFallback = resolveRoutedHandler(call.slug, call.verb, contexts, apis);
  if (routedFallback) {
    checkRoutedHandlerCall(routedFallback, call, source, diags);
    return;
  }
  // One `diags.push` per catalog key rather than one push over a
  // message-picking helper, and each object spelled out in full rather than
  // spread from a shared `common`.  TWO ratchets read these sites TEXTUALLY:
  // `diagnostic-catalog.test.ts` requires a literal `diagMessage("…")` as the
  // `message:` expression (a helper returning the rendered string reads as
  // inline wording), and `diagnostic-codes-completeness.test.ts` requires a
  // literal `code:` property on the pushed object (a `...common` spread hides
  // it).  The repetition is the price of both staying checkable.
  if (call.verb === "create") {
    diags.push({
      severity: "error",
      code: "loom.e2e-unrouted-verb",
      source,
      message: diagMessage("loom.e2e-unrouted-verb#create", {
        magicId: "api",
        slug: call.slug,
        aggregate: agg.name,
      }),
    });
    return;
  }
  if (call.verb === "destroy") {
    diags.push({
      severity: "error",
      code: "loom.e2e-unrouted-verb",
      source,
      message: diagMessage("loom.e2e-unrouted-verb#destroy", {
        slug: call.slug,
        aggregate: agg.name,
      }),
    });
    return;
  }
  if (call.verb === "history") {
    diags.push({
      severity: "error",
      code: "loom.e2e-unrouted-verb",
      source,
      message: diagMessage("loom.e2e-unrouted-verb#history", {
        slug: call.slug,
        aggregate: agg.name,
      }),
    });
    return;
  }
  // A find the repository DECLARES but the derivation does not list is a
  // compiler-synthesized retrieval — a different fix from "no such verb", so a
  // different message.
  if ((repo?.finds ?? []).some((f) => f.name === call.verb)) {
    diags.push({
      severity: "error",
      code: "loom.e2e-unrouted-verb",
      source,
      message: diagMessage("loom.e2e-unrouted-verb#find", {
        slug: call.slug,
        verb: call.verb,
        aggregate: agg.name,
      }),
    });
    return;
  }
  diags.push({
    severity: "error",
    code: "loom.e2e-unrouted-verb",
    source,
    message: diagMessage("loom.e2e-unrouted-verb#verb", {
      slug: call.slug,
      verb: call.verb,
      aggregate: agg.name,
      routed: routedVerbs(agg, repo, ops).join(", ") || "(none)",
    }),
  });
}

/**
 * The route-contract question for an explicit `route … -> <Ctx>.<Handler>`
 * binding.  The route EXISTS by construction — the resolver found it in the
 * api's own list, and `loom.route-handler-unresolved` already gates a route
 * whose target does not resolve — so what is left to check is whether the CALL
 * matches the request the backends emit for it:
 *
 *   • ARITY — arguments bind POSITIONALLY to the declared params.  A wrong
 *     count shifts every later argument into the wrong slot, and on a
 *     path-param route that renders a URL with a literal `undefined` segment.
 *   • A SENDABLE BODY — a `GET`/`DELETE` route whose handler declares a param
 *     that is not a `{token}` in the path.  Every backend reads that param
 *     from a request BODY; `fetch` cannot send one on those methods, so the
 *     call is not expressible and the argument would silently vanish.
 */
function checkRoutedHandlerCall(
  t: RoutedHandlerTarget,
  call: MagicCall,
  source: string,
  diags: LoomDiagnostic[],
): void {
  if (call.argCount !== t.bindings.length) {
    diags.push({
      severity: "error",
      code: "loom.e2e-routed-handler-arity",
      source,
      message: diagMessage("loom.e2e-routed-handler-arity", {
        slug: call.slug,
        verb: call.verb,
        expected: t.bindings.length,
        got: call.argCount,
        params: t.bindings.map((b) => b.param.name).join(", ") || "(none)",
        method: t.route.method,
        path: t.route.path,
      }),
    });
    return;
  }
  if (routedHandlerNeedsUnsendableBody(t)) {
    diags.push({
      severity: "error",
      code: "loom.e2e-routed-handler-bodyless-method",
      source,
      message: diagMessage("loom.e2e-routed-handler-bodyless-method", {
        slug: call.slug,
        verb: call.verb,
        method: t.route.method,
        path: t.route.path,
        params: t.bindings
          .filter((b) => b.source === "body")
          .map((b) => b.param.name)
          .join(", "),
      }),
    });
  }
}

/** Does the route `renderApiCall` will emit for `verb` exist in the derivation?
 *  The arms are in the RENDERER's resolution order, not in a more charitable
 *  one — `create` is routed to `POST /<aggs>` before any operation lookup, so a
 *  hypothetical non-canonical operation named `create` must not rescue it. */
function apiRouteExists(
  verb: string,
  agg: AggregateIR,
  repo: RepositoryIR | undefined,
  ops: readonly ApiOperationIR[],
): boolean {
  if (verb === "create") return ops.some((o) => o.kind === "create");
  if (verb === "getById") return ops.some((o) => o.kind === "getById");
  // `GET /<aggs>/{id}/history` is in `apiSurfaceCoverage.notLifted` — the
  // derived history read deliberately sits beside `finds` on
  // `RepositoryIR.historyFind` — so it is checked against that field, exactly
  // as the renderer gates it.
  if (verb === "history") return repo?.historyFind != null;
  // The canonical destroy only: a NAMED `destroy archive { }` has no DELETE
  // route, and the renderer lets it fall through to the operation arm.
  if (verb === "destroy" && agg.canonicalDestroy) return ops.some((o) => o.kind === "destroy");
  if (ops.some((o) => o.kind === "operation" && o.operation?.name === verb)) return true;
  // A find must be one the derivation LISTS.  `findRepoQuery` in the renderer
  // matches any `repo.finds` entry by name, including a `synthesized: true`
  // retrieval (the criterion-backed reads enrichment materialises for
  // `domainService` bodies) — and the derivation skips exactly those, so
  // calling one emitted a GET no backend mounts.
  return ops.some((o) => o.kind === "find" && o.find?.name === verb);
}

// ---------------------------------------------------------------------------
// The ui surface — `ui.<agg>.<verb>(…)` → a Playwright page object
// ---------------------------------------------------------------------------

function checkUiVerb(
  call: MagicCall,
  contexts: BoundedContextIR[],
  source: string,
  diags: LoomDiagnostic[],
): void {
  if (call.slug === "workflows") return;
  const resolved = resolveAggregate(call.slug, contexts);
  if (!resolved) return;
  const { agg, repo, ctx } = resolved;
  const ops = deriveAggregateOperations(agg, repo, apiStatusContext(ctx));
  // `renderAggregateCall` (ui-e2e-render.ts) addresses exactly three shapes:
  // the New-page create flow, the Detail-page goto, and a public operation's
  // detail-page button.  `create` is gated on the same `emitsRestCreate` the
  // scaffold's `dropNonConstructibleNewPages` pass uses, so a non-constructible
  // aggregate has no New page for the flow to drive — and no POST behind it.
  if (call.verb === "create") {
    if (ops.some((o) => o.kind === "create")) return;
    diags.push({
      severity: "error",
      code: "loom.e2e-unrouted-verb",
      message: diagMessage("loom.e2e-unrouted-verb#create", {
        magicId: "ui",
        slug: call.slug,
        aggregate: agg.name,
      }),
      source,
    });
    return;
  }
  if (call.verb === "getById") return;
  if (ops.some((o) => o.kind === "operation" && o.operation?.name === call.verb)) return;
  diags.push({
    severity: "error",
    code: "loom.e2e-unrouted-verb",
    message: diagMessage("loom.e2e-unrouted-verb#ui-verb", {
      slug: call.slug,
      verb: call.verb,
      known: [
        ...(ops.some((o) => o.kind === "create") ? ["create"] : []),
        "getById",
        ...ops.flatMap((o) => (o.kind === "operation" && o.operation ? [o.operation.name] : [])),
      ].join(", "),
    }),
    source,
  });
}

// ---------------------------------------------------------------------------
// Message inputs
// ---------------------------------------------------------------------------

/** Every verb the derivation says this aggregate actually serves — the
 *  "available" list the diagnostic offers, built from the ROUTES rather than
 *  from the declarations, so it can never suggest a verb that would trip this
 *  same check. */
function routedVerbs(
  agg: AggregateIR,
  repo: RepositoryIR | undefined,
  ops: readonly ApiOperationIR[],
): string[] {
  const out: string[] = [];
  if (ops.some((o) => o.kind === "create")) out.push("create");
  if (ops.some((o) => o.kind === "getById")) out.push("getById");
  if (agg.canonicalDestroy && ops.some((o) => o.kind === "destroy")) out.push("destroy");
  if (repo?.historyFind) out.push("history");
  for (const o of ops) if (o.kind === "operation" && o.operation) out.push(o.operation.name);
  for (const o of ops) if (o.kind === "find" && o.find) out.push(o.find.name);
  return out;
}

// ---------------------------------------------------------------------------
// Collection + resolution helpers
// ---------------------------------------------------------------------------

/** Every `<magicId>.<slug>.<verb>(…)` call an e2e body makes.  Rides
 *  `src/ir/util/walk.ts` (CLAUDE.md "No hand-rolled IR walks") so a call
 *  hidden in a `match` arm, a `list` literal or a block-body lambda is seen —
 *  the same class of miss the `ir-walk-census` ratchet exists to prevent. */
function collectMagicCalls(statements: readonly TestStmtIR[], magicId: "api" | "ui"): MagicCall[] {
  const out: MagicCall[] = [];
  const visit = (e: ExprIR): void => {
    const c = matchMagicCall(e, magicId);
    if (c) out.push(c);
  };
  for (const s of statements) {
    if (s.kind === "expect" || s.kind === "expect-throws") walkExprDeep(s.expr, visit);
    else walkStmtExprsDeep(s, visit);
  }
  return out;
}

function matchMagicCall(e: ExprIR, magicId: "api" | "ui"): MagicCall | null {
  if (e.kind !== "method-call") return null;
  if (e.receiver.kind !== "member") return null;
  const r = e.receiver;
  if (r.receiver.kind !== "ref" || r.receiver.name !== magicId) return null;
  return { slug: r.member, verb: e.member, argCount: e.args.length };
}

/** The aggregate a slug names, with the repository serving it and the context
 *  it lives in — the three inputs `deriveAggregateOperations` needs.  Slug
 *  spellings mirror `findAggregateBySlug` in both renderers. */
function resolveAggregate(
  slug: string,
  contexts: BoundedContextIR[],
): { agg: AggregateIR; repo: RepositoryIR | undefined; ctx: BoundedContextIR } | undefined {
  for (const ctx of contexts) {
    for (const agg of ctx.aggregates) {
      if (
        lowerFirst(agg.name) === slug ||
        snake(plural(agg.name)) === slug ||
        lowerFirst(plural(agg.name)) === slug
      ) {
        const repo = contexts
          .flatMap((c) => c.repositories)
          .find((r) => r.aggregateName === agg.name);
        return { agg, repo, ctx };
      }
    }
  }
  return undefined;
}

function findProjectionBySlug(slug: string, contexts: BoundedContextIR[]): boolean {
  return contexts.some((c) =>
    c.projections.some((p) => lowerFirst(p.name) === slug || snake(p.name) === slug),
  );
}

function collectContexts(
  d: { contextNames: string[] },
  modulesByName: Map<string, SubdomainIR>,
): BoundedContextIR[] {
  const want = new Set(d.contextNames);
  const out: BoundedContextIR[] = [];
  for (const m of modulesByName.values()) {
    for (const c of m.contexts) if (want.has(c.name)) out.push(c);
  }
  return out;
}

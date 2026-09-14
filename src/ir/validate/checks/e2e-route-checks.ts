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
import {
  buildCreateInput,
  forApiRead,
  isRequiredCreateInput,
  wireFieldsForAggregate,
} from "../../enrich/wire-projection.js";
import type {
  AggregateIR,
  BoundedContextIR,
  ExprIR,
  LiteralKind,
  RepositoryIR,
  SubdomainIR,
  SystemIR,
  TestE2EIR,
  TestStmtIR,
  TypeIR,
} from "../../types/loom-ir.js";
import {
  type ApiOperationIR,
  apiStatusContext,
  deriveAggregateOperations,
} from "../../util/api-surface.js";
import { walkExprDeep, walkStmtExprsDeep } from "../../util/walk.js";
import type { LoomDiagnostic } from "./diagnostic.js";

/** One `<magicId>.<slug>.<verb>(…)` call found in an e2e body. */
interface MagicCall {
  slug: string;
  verb: string;
  /** The call's arguments, in source order — the PAYLOAD half of this file
   *  judges them against the create-input / parameter contract. */
  args: readonly ExprIR[];
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
  const source = `${sys.name}/${test.name}`;
  // A ui-kind test binds BOTH magic receivers — its kind comes from the target
  // deployable's platform, not from what the body spells — so an api-shaped
  // body aimed at a UI-mounting deployable legitimately writes `api.…` and its
  // calls must be routed-checked too.
  // The PAYLOAD half runs only on a verb that ROUTES.  A body aimed at a route
  // that does not exist has no contract to be measured against, and a second
  // complaint about an already-refused call is the double-report this packet
  // exists to remove, not to add to.  The same gate covers the RESPONSE half:
  // a call with no route has no response body either.
  const routed = new Set<string>();
  for (const call of collectMagicCalls(test.statements, "api")) {
    if (!checkApiVerb(call, contexts, source, diags)) continue;
    routed.add(`${call.slug}.${call.verb}`);
    const resolved = resolveAggregate(call.slug, contexts);
    if (resolved) checkApiPayload(call, resolved.agg, contexts, source, diags);
  }
  checkResponseFields(test, contexts, routed, source, diags);
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

/** The route contract's verdict on one call: which complaint it has, and the
 *  derivation inputs that complaint needs — or `null` when it has none (the
 *  verb routes, or the call is outside this check's ground truth).
 *
 *  Computed ONCE and read by two consumers — the reporter below and
 *  {@link routeContractWillReport}, which `test-checks.ts` consults so that one
 *  mistake yields one diagnostic.  A second copy of this DECISION is exactly
 *  the drift that would let both checks answer a call, or neither.
 *
 *  It carries a TAG rather than a rendered message on purpose: two ratchets
 *  read the push sites textually — `diagnostic-catalog.test.ts` requires a
 *  literal `diagMessage("…")` as the `message:` expression, and
 *  `diagnostic-codes-completeness.test.ts` a literal `code:` property — so the
 *  rendering has to stay inline at each push, even though the decision does
 *  not. */
type VerbVerdict =
  | { readonly tag: "create"; readonly aggregate: string }
  | { readonly tag: "destroy"; readonly aggregate: string }
  | { readonly tag: "history"; readonly aggregate: string }
  | { readonly tag: "find"; readonly aggregate: string }
  | { readonly tag: "verb"; readonly aggregate: string; readonly routed: string }
  | { readonly tag: "ui-create"; readonly aggregate: string }
  | { readonly tag: "ui-verb"; readonly known: string };

/** Does this call's verb resolve to a route THIS compilation emits?
 *  `null` ⇒ nothing to say. */
function apiVerbVerdict(call: MagicCall, contexts: BoundedContextIR[]): VerbVerdict | null {
  // `api.workflows.<name>` and `api.<projection>.{byKey,list}` route outside
  // `deriveAggregateOperations` (both are in its documented `notLifted` set),
  // so this check has no ground truth for them — `test-checks.ts` resolves
  // them by name and is the whole story there.
  if (call.slug === "workflows") return null;
  if (findProjectionBySlug(call.slug, contexts)) return null;
  const resolved = resolveAggregate(call.slug, contexts);
  // An unresolved slug already raises `loom.e2e-unknown-aggregate`; a second
  // diagnostic for the same call would just be noise.
  if (!resolved) return null;
  const { agg, repo, ctx } = resolved;
  const ops = deriveAggregateOperations(agg, repo, apiStatusContext(ctx));
  if (apiRouteExists(call.verb, agg, repo, ops)) return null;
  if (call.verb === "create") return { tag: "create", aggregate: agg.name };
  if (call.verb === "destroy") return { tag: "destroy", aggregate: agg.name };
  if (call.verb === "history") return { tag: "history", aggregate: agg.name };
  // A find the repository DECLARES but the derivation does not list is a
  // compiler-synthesized retrieval — a different fix from "no such verb", so a
  // different message.
  if ((repo?.finds ?? []).some((f) => f.name === call.verb)) {
    return { tag: "find", aggregate: agg.name };
  }
  return {
    tag: "verb",
    aggregate: agg.name,
    routed: routedVerbs(agg, repo, ops).join(", ") || "(none)",
  };
}

/** Does `ui.<slug>.<verb>(…)` drive a page object the harness emits? */
function uiVerbVerdict(call: MagicCall, contexts: BoundedContextIR[]): VerbVerdict | null {
  if (call.slug === "workflows") return null;
  const resolved = resolveAggregate(call.slug, contexts);
  if (!resolved) return null;
  const { agg, repo, ctx } = resolved;
  const ops = deriveAggregateOperations(agg, repo, apiStatusContext(ctx));
  // `renderAggregateCall` (ui-e2e-render.ts) addresses exactly three shapes:
  // the New-page create flow, the Detail-page goto, and a public operation's
  // detail-page button.  `create` is gated on the same `emitsRestCreate` the
  // scaffold's `dropNonConstructibleNewPages` pass uses, so a non-constructible
  // aggregate has no New page for the flow to drive — and no POST behind it.
  if (call.verb === "create") {
    if (ops.some((o) => o.kind === "create")) return null;
    return { tag: "ui-create", aggregate: agg.name };
  }
  if (call.verb === "getById") return null;
  if (ops.some((o) => o.kind === "operation" && o.operation?.name === call.verb)) return null;
  return {
    tag: "ui-verb",
    known: [
      ...(ops.some((o) => o.kind === "create") ? ["create"] : []),
      "getById",
      ...ops.flatMap((o) => (o.kind === "operation" && o.operation ? [o.operation.name] : [])),
    ].join(", "),
  };
}

/** ONE MISTAKE, ONE DIAGNOSTIC.
 *
 *  `test-checks.ts` (`checkMagicCall`) and this file ask two different
 *  questions of the same call — does the verb NAME resolve to something in the
 *  model, and does it resolve to a ROUTE — and for a verb that is neither, both
 *  used to answer:
 *
 *      api.widgets.noSuchOperation(w)
 *      → loom.e2e-unknown-method   "unknown method … Available: …"
 *      → loom.e2e-unrouted-verb    "resolves to no route … Routed verbs: …"
 *
 *  Two errors, one typo, two near-identical lists to read.  The routing answer
 *  is the one that survives, because it is the one that names the FIX: for
 *  `destroy` on an aggregate with no canonical destroy it says *add
 *  `with crudish`, or an unnamed `destroy { }` — a NAMED destroy is a domain
 *  command and gets no DELETE route*, where "unknown method" only lists what
 *  else exists.  So `test-checks.ts` consults this predicate before adding its
 *  own complaint, and reports only when this check will stay silent.
 *
 *  Deliberately a call INTO the decision (`apiVerbComplaint`/`uiVerbComplaint`),
 *  not a re-derivation of it: a second copy of the routing rule would drift and
 *  leave a call with either two diagnostics again or none at all. */
export function routeContractWillReport(
  magicId: "api" | "ui",
  call: { slug: string; verb: string },
  contexts: BoundedContextIR[],
): boolean {
  const shaped: MagicCall = { slug: call.slug, verb: call.verb, args: [] };
  return (
    (magicId === "api" ? apiVerbVerdict(shaped, contexts) : uiVerbVerdict(shaped, contexts)) !==
    null
  );
}

// One `diags.push` per catalog key rather than one push over a
// message-picking helper, and each object spelled out in full rather than
// spread from a shared `common`.  TWO ratchets read these sites TEXTUALLY:
// `diagnostic-catalog.test.ts` requires a literal `diagMessage("…")` as the
// `message:` expression (a helper returning the rendered string reads as
// inline wording), and `diagnostic-codes-completeness.test.ts` requires a
// literal `code:` property on the pushed object (a `...common` spread hides
// it).  The repetition above is the price of both staying checkable — which is
// why `VerbComplaint` carries an already-rendered `message` built at a literal
// `diagMessage("…")` site, and the two pushes below are the only `code:`
// bearers.

/** Reports the api verb's complaint, if any.  Returns true when the verb
 *  ROUTES — the precondition the payload half needs, since a body has no
 *  contract to be measured against until its route exists. */
function checkApiVerb(
  call: MagicCall,
  contexts: BoundedContextIR[],
  source: string,
  diags: LoomDiagnostic[],
): boolean {
  const verdict = apiVerbVerdict(call, contexts);
  if (!verdict) return true;
  if (verdict.tag === "create") {
    diags.push({
      severity: "error",
      code: "loom.e2e-unrouted-verb",
      source,
      message: diagMessage("loom.e2e-unrouted-verb#create", {
        magicId: "api",
        slug: call.slug,
        aggregate: verdict.aggregate,
      }),
    });
    return false;
  }
  if (verdict.tag === "destroy") {
    diags.push({
      severity: "error",
      code: "loom.e2e-unrouted-verb",
      source,
      message: diagMessage("loom.e2e-unrouted-verb#destroy", {
        slug: call.slug,
        aggregate: verdict.aggregate,
      }),
    });
    return false;
  }
  if (verdict.tag === "history") {
    diags.push({
      severity: "error",
      code: "loom.e2e-unrouted-verb",
      source,
      message: diagMessage("loom.e2e-unrouted-verb#history", {
        slug: call.slug,
        aggregate: verdict.aggregate,
      }),
    });
    return false;
  }
  // A find the repository DECLARES but the derivation does not list is a
  // compiler-synthesized retrieval — a different fix from "no such verb", so a
  // different message.
  if (verdict.tag === "find") {
    diags.push({
      severity: "error",
      code: "loom.e2e-unrouted-verb",
      source,
      message: diagMessage("loom.e2e-unrouted-verb#find", {
        slug: call.slug,
        verb: call.verb,
        aggregate: verdict.aggregate,
      }),
    });
    return false;
  }
  if (verdict.tag === "verb") {
    diags.push({
      severity: "error",
      code: "loom.e2e-unrouted-verb",
      source,
      message: diagMessage("loom.e2e-unrouted-verb#verb", {
        slug: call.slug,
        verb: call.verb,
        aggregate: verdict.aggregate,
        routed: verdict.routed,
      }),
    });
  }
  return false;
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
  const verdict = uiVerbVerdict(call, contexts);
  if (!verdict) return;
  if (verdict.tag === "ui-create") {
    diags.push({
      severity: "error",
      code: "loom.e2e-unrouted-verb",
      message: diagMessage("loom.e2e-unrouted-verb#create", {
        magicId: "ui",
        slug: call.slug,
        aggregate: verdict.aggregate,
      }),
      source,
    });
    return;
  }
  if (verdict.tag === "ui-verb") {
    diags.push({
      severity: "error",
      code: "loom.e2e-unrouted-verb",
      message: diagMessage("loom.e2e-unrouted-verb#ui-verb", {
        slug: call.slug,
        verb: call.verb,
        known: verdict.known,
      }),
      source,
    });
  }
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
  return { slug: r.member, verb: e.member, args: e.args };
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

// ---------------------------------------------------------------------------
// The PAYLOAD contract — what the body SENDS and what it READS BACK
//
// The arms above answer "does this verb route anywhere".  A verb that routes
// can still carry a body the route will refuse, and the compiler derives
// everything needed to say so: `createInput` (the reified create contract,
// enrichment phase ⑥), the operation's declared parameter list, and
// `wireFieldsForAggregate` (the response projection every backend serves).
//
// The cost of not checking is not merely the round trip to find out.  A
// NEGATIVE test passes for the WRONG REASON:
//
//     expect(api.widgets.create({ kode: "A" })).toThrow(422)
//
// is green because of the typo, not because of the domain rule it names.  This
// is not hypothetical — a `schedule(techId: …)` called with `{ technicianId: … }`
// generated, ran, and 422'd on an unknown field, with `0 error(s)` at compile
// time.
//
// WIRE, NOT DOMAIN.  An e2e body drives the deployable over HTTP: it sends
// JSON and reads JSON.  So every judgement here is against the WIRE form —
// keys as the wire spells them, an enum as its serialized member string
// (`"Placed"`, not `Placed`; the bare form is already
// `loom.e2e-unresolved-ref`'s business and is not re-reported here), a
// `datetime` as an ISO-8601 string, a `money` as a JSON scalar.
//
// WHAT IS DELIBERATELY NOT CHECKED, and why — a gate that guesses is worse
// than no gate, because a false positive turns a valid model red:
//
//   - `find` / `list` / `all` / projection reads.  Their argument is a QUERY
//     string, not a body, and it carries an implicit pagination set
//     (`page`, `pageSize`, `sort`, `dir`) on top of the declared params — 145
//     `all(...)` sites in the corpus depend on it.  Their RESPONSE is a
//     per-cardinality envelope (`{items,total}` for a list find, a bare row for
//     a unique-key one), which this layer has no derivation for.
//   - a non-literal value.  `cust.id`, `money("5.00")`'s companion conversions,
//     a nested `{…}` and a `[…]` are all admissible wire values whose type this
//     layer cannot decide; only a LITERAL is judged, and only against a SCALAR
//     declared type.
//   - a payload that is not an object literal at all (a bare `ref`).
//   - the `ui.` surface.  A `ui` body fills a FORM; its field vocabulary is the
//     page object's, not the wire's.
//
// Each is a named limitation, not an oversight: the sweep behind this gate
// enumerated all 1001 magic-call sites across the tracked `.ddd` corpus, and
// these are the shapes whose contract is not decidable here.
// ---------------------------------------------------------------------------

/** The create-input contract as the WIRE carries it: the reified
 *  `createInput` for a state-backed aggregate, or the create action's params
 *  for an event-sourced one — the exact split every backend's create-request
 *  schema makes (`routes-builder.ts`'s `esCreate` fork). */
function createBodyContract(agg: AggregateIR): { name: string; type: TypeIR; required: boolean }[] {
  if (agg.persistedAs === "eventLog") {
    const create = agg.creates?.[0];
    if (!create) return [];
    return create.params.map((p) => ({
      name: p.name,
      type: p.type,
      required: isRequiredCreateInput(p),
    }));
  }
  // `agg.createInput` is populated by enrichment and this check runs on an
  // `EnrichedLoomModel`; `buildCreateInput` is the total fallback the shared
  // helper keeps for pre-enrichment callers, so read through it rather than
  // asserting.
  return (agg.createInput ?? buildCreateInput(agg)).map((c) => ({
    name: c.field.name,
    type: c.field.type,
    required: c.requiredInput,
  }));
}

function checkApiPayload(
  call: MagicCall,
  agg: AggregateIR,
  contexts: BoundedContextIR[],
  source: string,
  diags: LoomDiagnostic[],
): void {
  if (call.verb === "create") {
    // The create body is argument 0 (`renderApiCall`: `args[0] ?? "{}"`).
    checkBody(call, call.args[0], createBodyContract(agg), contexts, source, diags, {
      kind: "create",
      aggregate: agg.name,
    });
    return;
  }
  const op = agg.operations.find((o) => o.visibility === "public" && o.name === call.verb);
  // An operation body is argument 1 — argument 0 is the id
  // (`renderOperationCall`: `args[1] ?? "{}"`).  A zero-param operation
  // legitimately passes no body at all.
  if (op) {
    checkBody(
      call,
      call.args[1],
      // `required: false` throughout, deliberately: the omission arm in
      // `checkBody` is create-only (see the note there), so computing a
      // required-set for an operation would be a value nothing reads.
      op.params.map((p) => ({ name: p.name, type: p.type, required: false })),
      contexts,
      source,
      diags,
      { kind: "operation" },
    );
  }
}

/** One object-literal body against one declared field/param contract. */
function checkBody(
  call: MagicCall,
  body: ExprIR | undefined,
  contract: { name: string; type: TypeIR; required: boolean }[],
  contexts: BoundedContextIR[],
  source: string,
  diags: LoomDiagnostic[],
  site: { kind: "create" | "operation"; aggregate?: string },
): void {
  // Only an object literal is a body this layer can read.  A bare `ref`
  // (`api.orders.confirm(id, payload)`) carries a shape from somewhere else.
  if (body?.kind !== "object") return;
  const byName = new Map(contract.map((c) => [c.name, c]));
  const seen = new Set<string>();
  let sawUnknownKey = false;
  for (const entry of body.fields) {
    seen.add(entry.name);
    const declared = byName.get(entry.name);
    if (!declared) {
      sawUnknownKey = true;
      // ONE mistake, ONE diagnostic: an unknown key says nothing about the
      // value it carries, so the type arm below is not also run for it.
      if (site.kind === "create") {
        diags.push({
          severity: "error",
          code: "loom.e2e-unknown-body-key",
          source,
          message: diagMessage("loom.e2e-unknown-body-key#create", {
            slug: call.slug,
            key: entry.name,
            aggregate: site.aggregate ?? "",
            known: contract.map((c) => c.name).join(", ") || "(none)",
          }),
        });
      } else {
        diags.push({
          severity: "error",
          code: "loom.e2e-unknown-body-key",
          source,
          message: diagMessage("loom.e2e-unknown-body-key#operation", {
            slug: call.slug,
            verb: call.verb,
            key: entry.name,
            known: contract.map((c) => c.name).join(", ") || "(none)",
          }),
        });
      }
      continue;
    }
    checkLiteralAgainstType(call, entry.name, entry.value, declared.type, contexts, source, diags);
  }
  // Missing required input — create only.  An operation's declared params are
  // NOT all client-supplied on every backend (a defaulted param is seeded by
  // the scaffolded form), and no corpus site exercises the omission, so
  // claiming it here would be a guess.
  if (site.kind !== "create") return;
  // ONE MISTAKE, ONE DIAGNOSTIC, again: a misspelled key makes the field it
  // meant to spell "missing" too, and `{ kode: "A" }` reporting both an unknown
  // `kode` AND an absent `code` is one typo described twice.  The unknown key
  // is the actionable half — fixing it resolves the other — so the absence arm
  // speaks only for a body whose every key was recognised.
  if (sawUnknownKey) return;
  const missing = contract.filter((c) => c.required && !seen.has(c.name)).map((c) => c.name);
  if (missing.length === 0) return;
  diags.push({
    severity: "error",
    code: "loom.e2e-missing-required-field",
    source,
    message: diagMessage("loom.e2e-missing-required-field", {
      slug: call.slug,
      aggregate: site.aggregate ?? "",
      missing: missing.map((m) => `'${m}'`).join(", "),
      known:
        contract
          .filter((c) => c.required)
          .map((c) => c.name)
          .join(", ") || "(none)",
    }),
  });
}

/** A literal in a body position, against the WIRE form of its declared type.
 *  Silent for every non-literal value and for every non-scalar target — see
 *  the header's list of deliberate non-checks. */
function checkLiteralAgainstType(
  call: MagicCall,
  key: string,
  value: ExprIR,
  declaredType: TypeIR,
  contexts: BoundedContextIR[],
  source: string,
  diags: LoomDiagnostic[],
): void {
  if (value.kind !== "literal") return;
  const t = declaredType.kind === "optional" ? declaredType.inner : declaredType;
  // `null` returns before the kind table below, and the return is load-bearing:
  // without it every legitimately-null value would fall through to "no accepted
  // literal kind matched" and be reported as a type mismatch.
  //
  // Judging it properly would need to know whether the field is nullable, and
  // that is NOT decidable from `TypeIR` alone here — a `f: T?` carries its
  // optionality on the `FieldIR` flag, which does not always reach the type
  // (see `isNullable` in `wire-projection.ts`, which has to consult both).  So
  // an explicit `null` is admitted everywhere rather than guessed at.
  if (value.lit === "null") return;
  const accepted = acceptedLiteralKinds(t, contexts);
  if (!accepted) return; // not a scalar target — nothing decidable here
  if (accepted.has(value.lit)) {
    // The enum MEMBERSHIP arm: an enum crosses the wire as the member name,
    // so a string that is not a member is the same 422 by another route.
    if (t.kind === "enum") {
      const members = enumMembers(t.name, contexts);
      if (members && !members.includes(value.value)) {
        diags.push({
          severity: "error",
          code: "loom.e2e-body-type-mismatch",
          source,
          message: diagMessage("loom.e2e-body-type-mismatch#enum", {
            slug: call.slug,
            verb: call.verb,
            key,
            declared: t.name,
            got: `the string "${value.value}"`,
            members: members.join(", ") || "(none)",
          }),
        });
      }
    }
    return;
  }
  diags.push({
    severity: "error",
    code: "loom.e2e-body-type-mismatch",
    source,
    message: diagMessage("loom.e2e-body-type-mismatch", {
      slug: call.slug,
      verb: call.verb,
      key,
      declared: describeType(t),
      got: describeLiteral(value.lit, value.value),
    }),
  });
}

/** The literal kinds the WIRE form of a scalar type admits, or `undefined`
 *  when the target is not a scalar (a value object, an entity, a containment,
 *  an array, `json`, a `File`) and a literal there says nothing decidable.
 *
 *  Deliberately GENEROUS on the numeric and stringly-serialized types: `money`
 *  and `decimal` reach the wire as a JSON string on some backends and a JSON
 *  number on others (the reason `e2e-render.ts` funnels every numeric
 *  conversion through `__num`), so both spellings are admissible and only a
 *  categorically wrong literal — a string for an `int`, an int for a `bool` —
 *  is refused. */
function acceptedLiteralKinds(
  t: TypeIR,
  contexts: BoundedContextIR[],
): Set<LiteralKind> | undefined {
  if (t.kind === "id") return new Set(["string"]);
  if (t.kind === "enum") {
    // An enum whose declaration is not in the deployable's contexts (a root
    // enum) still serializes as a string; only the membership arm needs the
    // declaration, and it checks for itself.
    void enumMembers(t.name, contexts);
    return new Set(["string"]);
  }
  if (t.kind !== "primitive") return undefined;
  switch (t.name) {
    case "string":
      return new Set(["string"]);
    case "int":
    case "long":
      return new Set(["int", "long"]);
    case "decimal":
    case "money":
      return new Set(["int", "long", "decimal", "money", "string"]);
    case "bool":
      return new Set(["bool"]);
    case "datetime":
      return new Set(["string", "now"]);
    case "guid":
      return new Set(["string"]);
    // `json` is an opaque blob and `File` a fixed wire object — neither has a
    // literal form this layer can judge.
    default:
      return undefined;
  }
}

function enumMembers(name: string, contexts: BoundedContextIR[]): string[] | undefined {
  for (const c of contexts) {
    const e = c.enums.find((x) => x.name === name);
    if (e) return e.values;
  }
  return undefined;
}

function describeType(t: TypeIR): string {
  if (t.kind === "primitive") return t.name;
  if (t.kind === "enum") return t.name;
  if (t.kind === "id") return `${t.targetName} id`;
  return t.kind;
}

function describeLiteral(lit: LiteralKind, value: string): string {
  if (lit === "string") return `the string "${value}"`;
  if (lit === "bool") return `the bool ${value}`;
  if (lit === "now") return "now()";
  return `the ${lit} ${value}`;
}

// ---------------------------------------------------------------------------
// Response-field reads — `let x = api.<agg>.getById(…)` then `x.<field>`
// ---------------------------------------------------------------------------

/** The two verbs whose response body this layer knows exactly: `getById`
 *  serves the api-read wire shape, and `create` answers an id envelope that
 *  every backend widens at most to that same shape.  Checking their union is
 *  what lets `create` reject a genuinely invented field without this gate
 *  having to adjudicate which backends return the whole entity on 201.
 *
 *  Every other verb is skipped — see the header. */
const SHAPED_RESPONSE_VERBS = new Set(["getById", "create"]);

function checkResponseFields(
  test: TestE2EIR,
  contexts: BoundedContextIR[],
  routed: ReadonlySet<string>,
  source: string,
  diags: LoomDiagnostic[],
): void {
  // `let <name> = api.<slug>.<verb>(…)` — the only binding form whose response
  // shape is known.  A rebinding (two `let`s of the same name) is not legal in
  // a test body, so a flat map is enough.
  const bound = new Map<string, MagicCall>();
  for (const s of test.statements) {
    if (s.kind !== "let") continue;
    const c = matchMagicCall(s.expr, "api");
    if (c && SHAPED_RESPONSE_VERBS.has(c.verb) && routed.has(`${c.slug}.${c.verb}`)) {
      bound.set(s.name, c);
    }
  }
  if (bound.size === 0) return;
  const seen = new Set<string>();
  const visit = (e: ExprIR): void => {
    if (e.kind !== "member") return;
    if (e.receiver.kind !== "ref") return;
    const call = bound.get(e.receiver.name);
    if (!call) return;
    const resolved = resolveAggregate(call.slug, contexts);
    if (!resolved) return;
    const readable = forApiRead(wireFieldsForAggregate(resolved.agg)).map((w) => w.name);
    if (readable.includes(e.member)) return;
    // An `extends` subtype does not carry its abstract base's fields in its own
    // `fields` (the I1 note on `AggregateIR.extendsAggregate`), so a read of an
    // inherited field is not decidable here and the whole aggregate is skipped
    // rather than half-judged.
    if (resolved.agg.extendsAggregate) return;
    // One read, one diagnostic, however many times the body repeats it.
    const key = `${e.receiver.name}.${e.member}`;
    if (seen.has(key)) return;
    seen.add(key);
    diags.push({
      severity: "error",
      code: "loom.e2e-unknown-response-field",
      source,
      message: diagMessage("loom.e2e-unknown-response-field", {
        binding: e.receiver.name,
        field: e.member,
        slug: call.slug,
        verb: call.verb,
        aggregate: resolved.agg.name,
        known: readable.join(", ") || "(none)",
      }),
    });
  };
  for (const s of test.statements) {
    if (s.kind === "expect" || s.kind === "expect-throws") walkExprDeep(s.expr, visit);
    else walkStmtExprsDeep(s, visit);
  }
}

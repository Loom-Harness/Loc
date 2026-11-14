// ---------------------------------------------------------------------------
// `loom.target-unsupported` — the ONE check that reads the capability table.
//
// `src/util/target-capabilities.ts` lists, per target, a verdict for every
// construct × position.  This check walks each deployable once, asks each
// construct's detector where the model uses it, and refuses every use whose
// target verdict is `refused` — at the source location, with the row's stable
// reason as the message (`loom.target-unsupported#<slug>`).  So `ddd parse`
// reports everything `generate` could not render, and an emitter's own
// fallback for that construct is unreachable on a validated model.
//
// A detector per construct is a `Record` over the construct union, so a new
// table row cannot ship without one.  `owned` rows are skipped here: another
// check still raises them under its own code.
// ---------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import { platformFamily } from "../../../language/validators/data/platform-rules.js";
import {
  ADAPTER_REFUSALS,
  BACKEND_CONSTRUCTS,
  type BackendConstruct,
  backendCapability,
  type CapabilityVerdict,
  type CompositionVerdict,
  compositionCapability,
  FEATURE_TUPLES,
  type FeatureTuple,
  type RefusableUiConstruct,
  type TargetRefusalSlug,
  tupleFeatures,
  UI_CONSTRUCTS,
  uiCapability,
} from "../../../util/target-capabilities.js";
import { maskLaunderingEvents } from "../../enrich/mask-taint.js";
import { isTenantScopedStream } from "../../enrich/stream-tenancy.js";
import { cacheStoragesOf } from "../../plan/cache.js";
import { admittedReferences } from "../../plan/ref-scope.js";
import {
  type BoundedContextIR,
  type DeployableIR,
  type EnrichedAggregateIR,
  type ExprIR,
  isPayloadDeclKind,
  type Platform,
  type StmtIR,
  type SystemIR,
  type TypeIR,
  type UiIR,
  type WorkflowStmtIR,
  workflowEmitsCommandRoute,
} from "../../types/loom-ir.js";
import type { OriginRef } from "../../types/origin.js";
import { bodyUsesChart } from "../../util/chart.js";
import { dataGridHosts } from "../../util/data-grid.js";
import { entityHistoryReadHosts } from "../../util/entity-history-read.js";
import { aggregatesWithTuple } from "../../util/feature-atoms.js";
import { bodyUsesMoneyLocaleFormat } from "../../util/money-locale-format.js";
import { contextReadsOrgAncestors, registryContextName } from "../../util/org-context.js";
import { findValueObjectInScope } from "../../util/reachable-types.js";
import { aggregateIsEventSourced } from "../../util/resolve-datasource.js";
import { walkExprDeep, walkStmtsDeep } from "../../util/walk.js";
import { bodyWriteScopeGuards, writeScopeContext } from "../../util/write-scope-guards.js";
import {
  type OpSelfCallHit,
  opSelfCallHits,
  unvalidatedInvariants,
} from "./backend-syntax-checks.js";
import { boundMutatingCalls, callText, expectedFailureEntryPoints } from "./call-result-checks.js";
import { documentResidue } from "./datasource-checks.js";
import type { LoomDiagnostic } from "./diagnostic.js";
import { matchArmShapeRefusals } from "./elixir-match-stmt-checks.js";
import { documentStampSelfRead } from "./principal-guard-checks.js";
import { mountedUis, standardOpAwaitUses } from "./ui-framework-checks.js";

/** One use of a construct: where it sits, and the message parameters its
 *  refusal names besides the deployable and target. */
export interface ConstructUse {
  readonly what: string;
  readonly source: string;
  readonly origin?: OriginRef;
}

type UiDetector = (ui: UiIR, sys: SystemIR) => ConstructUse[];
type BackendDetector = (ctx: BoundedContextIR, sys: SystemIR, d: DeployableIR) => ConstructUse[];

/** The bodies of a ui a construct can sit in: every page and component. */
function uiBodies(ui: UiIR): Array<{ what: string; body: ExprIR | undefined; origin?: OriginRef }> {
  return [
    ...ui.pages.map((p) => ({ what: `page '${p.name}'`, body: p.body, origin: p.origin })),
    ...ui.components.map((c) => ({
      what: `component '${c.name}'`,
      body: c.body,
      origin: c.origin,
    })),
  ];
}

/** Where each UI construct is used. */
export const UI_DETECTORS: Readonly<Record<RefusableUiConstruct, UiDetector>> = {
  "primitive:DataGrid@body": (ui) =>
    dataGridHosts(ui).map((what) => ({ what, source: `${ui.name}/${what}` })),
  "primitive:Chart@body": (ui) =>
    uiBodies(ui)
      .filter((b) => bodyUsesChart(b.body))
      .map((b) => ({ what: b.what, source: `${ui.name}/${b.what}`, origin: b.origin })),
  "primitive:Money-locale-format@body": (ui) =>
    uiBodies(ui)
      .filter((b) => bodyUsesMoneyLocaleFormat(b.body))
      .map((b) => ({ what: b.what, source: `${ui.name}/${b.what}`, origin: b.origin })),
  "read:entity-history@body": (ui, sys) => {
    const aggregates = new Set<string>();
    for (const sd of sys.subdomains) {
      for (const c of sd.contexts) for (const a of c.aggregates) aggregates.add(a.name);
    }
    return entityHistoryReadHosts(ui, aggregates).map((what) => ({
      what,
      source: `${ui.name}/${what}`,
    }));
  },
  "stmt:match-await-standard-op@action": (ui, sys) =>
    standardOpAwaitUses(sys, ui).map((u) => ({
      what: `${u.where} (\`match await ${u.name}()\`)`,
      source: `${ui.name}/${u.where}`,
    })),
  "return:payload-or-error@api-client": (ui, sys) => {
    const out: ConstructUse[] = [];
    for (const param of ui.apiParams) {
      const api = sys.apis.find((a) => a.name === param.apiName);
      const sd = api && sys.subdomains.find((x) => x.name === api.sourceModule);
      for (const ctx of sd?.contexts ?? []) {
        for (const agg of ctx.aggregates) {
          for (const op of agg.operations) {
            const arm = payloadSuccessArm(op.returnType, agg.name);
            if (!arm) continue;
            out.push({
              what: `operation '${agg.name}.${op.name}' (returns \`${arm} or …\`) served to ui '${ui.name}'`,
              source: `${ui.name}/${api!.name}.${agg.name}.${op.name}`,
              origin: op.origin,
            });
          }
        }
      }
    }
    return out;
  },
};

/** The success arm of a `<payload> or <error>` return, when that arm is a
 *  declared non-error payload rather than the aggregate itself. */
function payloadSuccessArm(t: TypeIR | undefined, aggName: string): string | undefined {
  if (t?.kind !== "union") return undefined;
  const named = t.variants.flatMap((v) => (v.kind === "entity" ? [v] : []));
  if (!named.some((v) => v.declKind === "error")) return undefined;
  return named.find(
    (v) => v.name !== aggName && isPayloadDeclKind(v.declKind) && v.declKind !== "error",
  )?.name;
}

/** The `resource` bindings of a context whose kind and storage type satisfy
 *  `pick`, as uses.  `what` names the resource and the thing it binds. */
function resourceUses(
  ctx: BoundedContextIR,
  sys: SystemIR,
  pick: (
    ds: SystemIR["dataSources"][number],
    storageType: string | undefined,
  ) => string | undefined,
): ConstructUse[] {
  const out: ConstructUse[] = [];
  for (const ds of sys.dataSources) {
    if (ds.contextName !== ctx.name) continue;
    const storageType = sys.storages.find((st) => st.name === ds.storageName)?.type;
    const detail = pick(ds, storageType);
    if (detail === undefined) continue;
    out.push({
      what: `resource '${ds.name}' (${detail})`,
      source: `${sys.name}/${ds.name}`,
    });
  }
  return out;
}

/** The persistence kinds a relational store backs. */
const RELATIONAL_KINDS: ReadonlySet<string> = new Set(["state", "snapshot", "eventLog"]);

const kindUses =
  (kind: string): BackendDetector =>
  (ctx, sys) =>
    resourceUses(ctx, sys, (ds) =>
      ds.kind === kind ? `kind: ${kind}, storage '${ds.storageName}'` : undefined,
    );

const knobUses =
  (knob: "every" | "retain" | "readonly"): BackendDetector =>
  (ctx, sys) =>
    resourceUses(ctx, sys, (ds) =>
      ds[knob] !== undefined ? `sets \`${knob}:\`, kind: ${ds.kind}` : undefined,
    );

/** Every storage of `type`, wherever the system declares it. */
const storageDeclarations =
  (type: string): BackendDetector =>
  (_ctx, sys) =>
    sys.storages
      .filter((st) => st.type === type)
      .map((st) => ({
        what: `storage '${st.name}' (type: ${type})`,
        source: `${sys.name}/${st.name}`,
      }));

const storageTypeUses =
  (type: string): BackendDetector =>
  (ctx, sys) =>
    resourceUses(ctx, sys, (ds, t) =>
      t === type && RELATIONAL_KINDS.has(ds.kind)
        ? `kind: ${ds.kind}, storage '${ds.storageName}' of type: ${type}`
        : undefined,
    );

/** The aggregates of `ctx` that persist an `X id` to a `tenantOwned` target —
 *  on a relational save (`nonRelational` false) or an event-sourced / document
 *  / embedded one (true). */
function tenantOwnedReferenceUses(ctx: BoundedContextIR, nonRelational: boolean): ConstructUse[] {
  return ctx.aggregates
    .filter((agg) => !agg.isAbstract && admittedReferences(agg, ctx.aggregates).length > 0)
    .filter(
      (agg) =>
        (aggregateIsEventSourced(agg) || (agg.savingShape ?? "relational") !== "relational") ===
        nonRelational,
    )
    .map((agg) => ({
      what: `aggregate '${agg.name}' references the tenantOwned ${admittedReferences(
        agg,
        ctx.aggregates,
      )
        .map((r) => `'${r.target}' ('${r.field}')`)
        .join(", ")}`,
      source: `${ctx.name}/aggregate ${agg.name}`,
      origin: agg.origin,
    }));
}

/** Where each backend construct is used, per hosted context. */
export const BACKEND_DETECTORS: Readonly<Record<BackendConstruct, BackendDetector>> = {
  "stmt:requires@event-sourced-create": (ctx) => {
    const out: ConstructUse[] = [];
    for (const agg of ctx.aggregates) {
      if (!aggregateIsEventSourced(agg)) continue;
      for (const create of agg.creates ?? []) {
        if (!create.statements.some((s) => s.kind === "requires")) continue;
        const what = `aggregate '${agg.name}' create '${create.name}'`;
        out.push({
          what,
          source: `${ctx.name}/aggregate ${agg.name}.${create.name}`,
          origin: create.origin,
        });
      }
    }
    return out;
  },
  "effect:mutate-held-row@command-body": (ctx) => {
    const bodies: { what: string; statements: WorkflowStmtIR[]; origin?: OriginRef }[] = [
      ...ctx.workflows
        .filter(workflowEmitsCommandRoute)
        .map((w) => ({ what: `workflow '${w.name}'`, statements: w.statements, origin: w.origin })),
      ...(ctx.commandHandlers ?? []).map((h) => ({
        what: `commandHandler '${h.name}'`,
        statements: h.statements,
      })),
    ];
    return bodies
      .filter(
        (b) => bodyWriteScopeGuards(b.statements, writeScopeContext(b.statements, ctx)).length > 0,
      )
      .map((b) => ({ what: b.what, source: `${ctx.name}/${b.what}`, origin: b.origin }));
  },
  "capability:tenantOwned@event-sourced": (ctx) =>
    ctx.aggregates.filter(isTenantScopedStream).map((agg) => ({
      what: `event-sourced aggregate '${agg.name}' with tenantOwned`,
      source: `${ctx.name}/aggregate ${agg.name}`,
      origin: agg.origin,
    })),
  "capability:shareable@aggregate": (ctx) =>
    ctx.aggregates
      .filter((agg) => agg.capabilities.includes("shareable"))
      .map((agg) => ({
        what: `shareable aggregate '${agg.name}'`,
        source: `${ctx.name}/aggregate ${agg.name}`,
        origin: agg.origin,
      })),
  "resource:replica@resource": (ctx, sys) =>
    resourceUses(ctx, sys, (ds) =>
      ds.kind === "replica" ? `kind: replica, storage '${ds.storageName}'` : undefined,
    ),
  // A cache resource changes only the deployables that wire it: one a backend
  // cannot realize is refused there, and a sibling backend that does not list
  // it reads the database as before.
  "resource:cache@resource": (ctx, sys, d) =>
    resourceUses(ctx, sys, (ds) =>
      d.dataSourceNames.includes(ds.name) &&
      cacheStoragesOf(sys, { dataSourceNames: [ds.name] }).length > 0
        ? `kind: cache, storage '${ds.storageName}'`
        : undefined,
    ),
  "resource:snapshot@resource": kindUses("snapshot"),
  "knob:every@resource": knobUses("every"),
  "knob:retain@resource": knobUses("retain"),
  "knob:readonly@resource": knobUses("readonly"),
  "resource:eventLog-on-kafka@resource": (ctx, sys) =>
    resourceUses(ctx, sys, (ds, t) =>
      ds.kind === "eventLog" && t === "kafka"
        ? `kind: eventLog, storage '${ds.storageName}' of type: kafka`
        : undefined,
    ),
  "storage:mysql@resource": storageTypeUses("mysql"),
  "storage:sqlite@resource": storageTypeUses("sqlite"),
  "storage:inMemory@resource": storageTypeUses("inMemory"),
  "storage:elastic@declaration": storageDeclarations("elastic"),
  "storage:meilisearch@declaration": storageDeclarations("meilisearch"),
  "storage:clickhouse@declaration": storageDeclarations("clickhouse"),
  "storage:bigquery@declaration": storageDeclarations("bigquery"),
  "storage:nats@declaration": storageDeclarations("nats"),
  "publish:event-sourced@broker-channel": (ctx, sys) => {
    const carried = brokerCarriedEvents(sys);
    const out: ConstructUse[] = [];
    for (const agg of ctx.aggregates) {
      if (!aggregateIsEventSourced(agg)) continue;
      const emitted = [...(agg.creates ?? []), ...agg.operations].flatMap((o) =>
        emittedEvents(o.statements),
      );
      const event = emitted.find((e) => carried.has(e));
      if (!event) continue;
      out.push({
        what: `event-sourced aggregate '${agg.name}' (emits '${event}', which a broker-bound channel carries)`,
        source: `${ctx.name}/aggregate ${agg.name}`,
        origin: agg.origin,
      });
    }
    return out;
  },
  "tenancy:remote-registry@deployable": (ctx, sys, d) => {
    const registryCtx = registryContextName(sys);
    if (!registryCtx || d.contextNames.includes(registryCtx) || !contextReadsOrgAncestors(ctx))
      return [];
    return [
      {
        what: `context '${ctx.name}' reads 'organizationContext.ancestors' (its registry '${sys.tenancy?.registryName}' is hosted by another deployable)`,
        source: ctx.name,
        origin: ctx.origin,
      },
    ];
  },
  "read:shareable-off-host@deployable": (ctx, sys, d) => {
    const contexts = sys.subdomains.flatMap((s) => s.contexts);
    return (ctx.projections ?? []).flatMap((p) => {
      if (!p.query || (p.query.sourceKind ?? "aggregate") !== "aggregate") return [];
      const home = p.query.sourceContext ?? ctx.name;
      if (d.contextNames.includes(home)) return [];
      const source = contexts
        .find((c) => c.name === home)
        ?.aggregates.find((a) => a.name === p.query?.source);
      if (!source?.capabilities.includes("shareable")) return [];
      return [
        {
          what: `projection '${p.name}' reads the shareable aggregate '${source.name}' off its host`,
          source: `${ctx.name}/${p.name}`,
          origin: p.origin,
        },
      ];
    });
  },
  "call:auth-required-api@resource": (ctx, sys) =>
    resourceUses(ctx, sys, (ds) => {
      if (ds.kind !== "api" || !ds.apiName) return undefined;
      const callee = sys.deployables.find((x) => x.serves.includes(ds.apiName!));
      return callee?.auth?.required
        ? `kind: api, calls '${ds.apiName}' on auth-required deployable '${callee.name}'`
        : undefined;
    }),
  "reference:tenant-owned@state": (ctx) => tenantOwnedReferenceUses(ctx, false),
  "reference:tenant-owned@non-relational": (ctx) => tenantOwnedReferenceUses(ctx, true),
  "timer:broker-channel@deployable": (ctx, sys) => {
    const carried = brokerCarriedEvents(sys);
    return sys.timerSources
      .filter((t) => t.context === ctx.name && carried.has(t.event))
      .map((t) => ({
        what: `timerSource '${t.name}' (its '${t.event}' rides a broker-bound channel)`,
        source: `${sys.name}/${t.name}`,
      }));
  },
  "derived:reads-masked-field@aggregate": (ctx) => {
    const out: ConstructUse[] = [];
    for (const agg of ctx.aggregates) {
      const masked = new Set(agg.fields.filter((f) => f.maskUnless).map((f) => f.name));
      if (masked.size === 0) continue;
      // The synthesized `inspect` derived is a log sink, not a wire field.
      for (const der of agg.derived.filter((x) => x.name !== agg.inspectDerived?.name)) {
        const field = ownFieldsRead(der.expr).find((n) => masked.has(n));
        if (!field) continue;
        out.push({
          what: `derived '${agg.name}.${der.name}' (reads masked field '${field}')`,
          source: `${ctx.name}/aggregate ${agg.name}.${der.name}`,
          origin: agg.origin,
        });
      }
    }
    return out;
  },
  "criterion:reads-masked-field@context": (ctx) => {
    const out: ConstructUse[] = [];
    for (const crit of ctx.criteria) {
      const target = crit.targetType.kind === "entity" ? crit.targetType.name : undefined;
      const agg = ctx.aggregates.find((a) => a.name === target);
      if (!agg) continue;
      const masked = new Set(agg.fields.filter((f) => f.maskUnless).map((f) => f.name));
      const field = ownFieldsRead(crit.body).find((n) => masked.has(n));
      if (!field) continue;
      out.push({
        what: `criterion '${crit.name}' (filters on masked field '${agg.name}.${field}')`,
        source: `${ctx.name}/criterion ${crit.name}`,
      });
    }
    return out;
  },
  "field:valueobject-collection@entity-part": (ctx) => {
    const out: ConstructUse[] = [];
    for (const agg of ctx.aggregates) {
      for (const part of agg.parts) {
        for (const f of part.fields) {
          const t = f.type.kind === "optional" ? f.type.inner : f.type;
          if (t.kind !== "array" || t.element.kind !== "valueobject") continue;
          out.push({
            what: `entity part '${agg.name}.${part.name}' field '${f.name}' (a ${t.element.name}[] collection)`,
            source: `${ctx.name}/aggregate ${agg.name}.${part.name}.${f.name}`,
            origin: agg.origin,
          });
        }
      }
    }
    return out;
  },
  "emit:masked-value@channel-event": (ctx) => maskedEventUses(ctx),
  "unique:masked-field@aggregate": (ctx) => maskedUniqueUses(ctx),
  "invariant:nested-valueobject@valueobject": (ctx) => {
    const out: ConstructUse[] = [];
    for (const vo of ctx.valueObjects) {
      for (const f of vo.fields) {
        const t = f.type.kind === "optional" ? f.type.inner : f.type;
        if (t.kind !== "valueobject") continue;
        const inner = findValueObjectInScope(ctx, t.name);
        if (!inner || inner.invariants.length === 0) continue;
        out.push({
          what: `value object '${vo.name}' field '${f.name}' (a '${inner.name}', which declares an invariant)`,
          source: `${ctx.name}/valueobject ${vo.name}.${f.name}`,
        });
      }
    }
    return out;
  },
  "call:bound-mutating@entry-body": (ctx) =>
    boundMutatingCalls(ctx).map(({ where, st }) => ({
      what: `${where}: \`let ${st.result.name} = ${callText(st)}(…)\``,
      source: `${ctx.name}/${where}`,
      origin: st.origin,
    })),
  "return:expected-failure@entry-point": (ctx) =>
    expectedFailureEntryPoints(ctx).map(({ where }) => ({
      what: `${where} answering an expected failure`,
      source: `${ctx.name}/${where}`,
    })),
  "stmt:match-arm-shape@body": (ctx) =>
    matchArmShapeRefusals(ctx).map(({ where, slug }) => ({
      what: `a statement \`match\` in ${where} (${slug})`,
      source: `${ctx.name}/${where}`,
    })),
  "invariant:unvalidated-shape@aggregate": (ctx) =>
    unvalidatedInvariants(ctx).map(({ agg, inv }) => ({
      what: `invariant '${inv.source}' on '${agg.name}'`,
      source: `${ctx.name}/${agg.name}`,
    })),
  "call:op-self-non-tail@operation": (ctx) => opSelfCalls(ctx, "position"),
  "call:private-op-reads-principal@operation": (ctx) => opSelfCalls(ctx, "actor"),
  "op:document-residue@aggregate": (ctx, sys) =>
    documentResidue(ctx, sys).map(({ agg, bits }) => ({
      what: `document aggregate '${agg.name}' (${bits})`,
      source: `${ctx.name}/${agg.name}`,
    })),
  "stamp:reads-aggregate@document": (ctx, sys) =>
    ctx.aggregates.flatMap((agg) => {
      const read = documentStampSelfRead(agg as EnrichedAggregateIR, ctx, sys);
      return read
        ? [
            {
              what: `stamp of '${agg.name}.${read.field}' reading the aggregate`,
              source: `${ctx.name}/${agg.name}`,
            },
          ]
        : [];
    }),
};

/** The operation self-calls of one kind, as construct uses. */
function opSelfCalls(ctx: BoundedContextIR, kind: OpSelfCallHit["kind"]): ConstructUse[] {
  return opSelfCallHits(ctx)
    .filter((h) => h.kind === kind)
    .map((h) => ({
      what: `operation '${h.agg.name}.${h.op.name}' calling '${h.eName}'`,
      source: `${ctx.name}/${h.agg.name}.${h.op.name}`,
    }));
}

/** Where each owned mask-sink construct meets: the channel events carrying a
 *  masked value, and the unique keys over a masked field. */
function maskedEventUses(ctx: BoundedContextIR): ConstructUse[] {
  const laundering = maskLaunderingEvents(ctx);
  return (ctx.channels ?? []).flatMap((ch) =>
    ch.carries
      .filter((e) => laundering.has(e))
      .map((e) => ({
        what: `event '${e}' on channel '${ch.name}' (carries masked field '${laundering.get(e)}')`,
        source: `${ctx.name}/channel/${ch.name}`,
      })),
  );
}

function maskedUniqueUses(ctx: BoundedContextIR): ConstructUse[] {
  return ctx.aggregates.flatMap((agg) => {
    const masked = new Set(agg.fields.filter((f) => f.maskUnless).map((f) => f.name));
    const cols = new Set(
      (agg.uniqueKeys ?? []).flatMap((uk) => uk.columns).filter((c) => masked.has(c)),
    );
    return [...cols].map((col) => ({
      what: `unique key over masked field '${agg.name}.${col}'`,
      source: `${ctx.name}/${agg.name}.${col}`,
      origin: agg.origin,
    }));
  });
}

/** Every event a channel carries when some `channelSource` binds that channel
 *  to a broker. */
function brokerCarriedEvents(sys: SystemIR): ReadonlySet<string> {
  const bound = new Set(sys.channelSources.map((cs) => cs.channelName.split(".").pop()));
  const out = new Set<string>();
  for (const sd of sys.subdomains) {
    for (const c of sd.contexts) {
      for (const ch of c.channels) if (bound.has(ch.name)) for (const e of ch.carries) out.add(e);
    }
  }
  return out;
}

/** The events a statement list emits, at any depth. */
function emittedEvents(stmts: readonly StmtIR[]): string[] {
  const out: string[] = [];
  for (const s of stmts) {
    walkStmtsDeep(s, (x) => {
      if (x.kind === "emit") out.push(x.eventName);
    });
  }
  return out;
}

/** The own fields an expression reads, by name. */
function ownFieldsRead(e: ExprIR): string[] {
  const out: string[] = [];
  walkExprDeep(e, (x) => {
    if (x.kind === "ref" && x.refKind === "this-prop") out.push(x.name);
    else if (x.kind === "member" && x.receiver.kind === "this") out.push(x.member);
  });
  return out;
}

/** Where each feature tuple meets on one aggregate of a hosted context.  The
 *  pool is the whole system, so an inheritance atom sees a base declared in a
 *  sibling context. */
export function tupleUses(
  tuple: FeatureTuple,
  ctx: BoundedContextIR,
  sys: SystemIR,
): ConstructUse[] {
  const pool = sys.subdomains.flatMap((sd) => sd.contexts.flatMap((c) => c.aggregates));
  const hosted = new Set(ctx.aggregates);
  const [a, b] = tupleFeatures(tuple);
  return aggregatesWithTuple(tuple, pool)
    .filter((agg) => hosted.has(agg))
    .map((agg) => ({
      what: `aggregate '${agg.name}' (\`${a}\` with \`${b}\`)`,
      source: `${ctx.name}/aggregate ${agg.name}`,
      origin: agg.origin,
    }));
}

/** Constructs declared once per system rather than per context: a refusal is
 *  raised once however many backend deployables share the verdict. */
const SYSTEM_SCOPED: ReadonlySet<BackendConstruct> = new Set([
  "storage:elastic@declaration",
  "storage:meilisearch@declaration",
  "storage:clickhouse@declaration",
  "storage:bigquery@declaration",
  "storage:nats@declaration",
]);

/** How the check looks a verdict up.  The default reads the shipped table; a
 *  test passes its own to prove every detector bites. */
export interface CapabilityLookup {
  ui(framework: string, construct: RefusableUiConstruct): CapabilityVerdict;
  backend(platform: Platform, construct: BackendConstruct): CapabilityVerdict | undefined;
  /** Absent: no tuple is refused (a test lookup about constructs only). */
  composition?(platform: Platform, tuple: FeatureTuple): CompositionVerdict | undefined;
}

const SHIPPED_TABLE: CapabilityLookup = {
  ui: uiCapability,
  backend: backendCapability,
  composition: compositionCapability,
};

/** Raise `loom.target-unsupported` for one use, worded by the row's reason.
 *  One literal catalog key per slug, so the catalog ratchet sees each
 *  message's call site. */
function refuse(
  diags: LoomDiagnostic[],
  slug: TargetRefusalSlug,
  use: ConstructUse,
  d: DeployableIR,
  target: string,
): void {
  const dName = d.name;
  const t = target || "unknown";
  switch (slug) {
    case "datagrid":
      refused(
        diags,
        diagMessage("loom.target-unsupported#datagrid", { what: use.what, dName, target: t }),
        use,
      );
      return;
    case "chart":
      refused(
        diags,
        diagMessage("loom.target-unsupported#chart", { what: use.what, dName, target: t }),
        use,
      );
      return;
    case "money-locale-format":
      refused(
        diags,
        diagMessage("loom.target-unsupported#money-locale-format", {
          what: use.what,
          dName,
          target: t,
        }),
        use,
      );
      return;
    case "entity-history-read":
      refused(
        diags,
        diagMessage("loom.target-unsupported#entity-history-read", {
          what: use.what,
          dName,
          target: t,
        }),
        use,
      );
      return;
    case "match-await-standard-op":
      refused(
        diags,
        diagMessage("loom.target-unsupported#match-await-standard-op", {
          what: use.what,
          dName,
          target: t,
        }),
        use,
      );
      return;
    case "lifecycle-guard-event-sourced":
      refused(
        diags,
        diagMessage("loom.target-unsupported#lifecycle-guard-event-sourced", {
          what: use.what,
          dName,
          target: t,
        }),
        use,
      );
      return;
    case "tenant-owned-event-sourced":
      refused(
        diags,
        diagMessage("loom.target-unsupported#tenant-owned-event-sourced", {
          what: use.what,
          dName,
          target: t,
        }),
        use,
      );
      return;
    case "resource-kind-unrealized":
      refused(
        diags,
        diagMessage("loom.target-unsupported#resource-kind-unrealized", {
          what: use.what,
          dName,
          target: t,
        }),
        use,
      );
      return;
    case "resource-knob-unrealized":
      refused(
        diags,
        diagMessage("loom.target-unsupported#resource-knob-unrealized", {
          what: use.what,
          dName,
          target: t,
        }),
        use,
      );
      return;
    case "storage-type-unbound":
      refused(
        diags,
        diagMessage("loom.target-unsupported#storage-type-unbound", {
          what: use.what,
          dName,
          target: t,
        }),
        use,
      );
      return;
    case "storage-type-unrealized":
      refused(
        diags,
        diagMessage("loom.target-unsupported#storage-type-unrealized", {
          what: use.what,
          dName,
          target: t,
        }),
        use,
      );
      return;
    case "feature-composition-broken":
      refused(
        diags,
        diagMessage("loom.target-unsupported#feature-composition-broken", {
          what: use.what,
          dName,
          target: t,
        }),
        use,
      );
      return;
    case "feature-composition-unwitnessed":
      refused(
        diags,
        diagMessage("loom.target-unsupported#feature-composition-unwitnessed", {
          what: use.what,
          dName,
          target: t,
        }),
        use,
      );
      return;
    case "reference-admission-unrealized":
      refused(
        diags,
        diagMessage("loom.target-unsupported#reference-admission-unrealized", {
          what: use.what,
          dName,
          target: t,
        }),
        use,
      );
      return;
    default: {
      const _exhaustive: never = slug;
      void _exhaustive;
    }
  }
}

function refused(diags: LoomDiagnostic[], message: string, use: ConstructUse): void {
  diags.push({
    severity: "error",
    code: "loom.target-unsupported",
    message,
    source: use.source,
    origin: use.origin,
  });
}

/** Refuse every use of a construct its target cannot render. */
export function validateTargetCapabilities(
  sys: SystemIR,
  diags: LoomDiagnostic[],
  lookup: CapabilityLookup = SHIPPED_TABLE,
): void {
  const ctxByName = new Map<string, BoundedContextIR>();
  for (const sd of sys.subdomains) for (const c of sd.contexts) ctxByName.set(c.name, c);
  const seen = new Set<string>();
  for (const d of sys.deployables) {
    for (const { ui, fw } of mountedUis(sys, d)) {
      for (const construct of UI_CONSTRUCTS) {
        const v = lookup.ui(fw, construct);
        if (v.verdict !== "refused") continue;
        for (const use of UI_DETECTORS[construct](ui, sys)) refuse(diags, v.slug, use, d, fw);
      }
    }
    for (const construct of BACKEND_CONSTRUCTS) {
      const v = lookup.backend(d.platform, construct);
      if (v?.verdict !== "refused") continue;
      for (const ctxName of d.contextNames) {
        const ctx = ctxByName.get(ctxName);
        if (!ctx) continue;
        for (const use of BACKEND_DETECTORS[construct](ctx, sys, d)) {
          if (SYSTEM_SCOPED.has(construct)) {
            const key = `${construct}|${use.source}`;
            if (seen.has(key)) continue;
            seen.add(key);
          }
          refuse(diags, v.slug, use, d, d.platform);
        }
      }
    }
    for (const tuple of FEATURE_TUPLES) {
      const v = lookup.composition?.(d.platform, tuple);
      if (v?.verdict !== "refused") continue;
      for (const ctxName of d.contextNames) {
        const ctx = ctxByName.get(ctxName);
        if (!ctx) continue;
        for (const use of tupleUses(tuple, ctx, sys)) refuse(diags, v.slug, use, d, d.platform);
      }
    }
    // The adapter axis: a construct the backend's default adapter realizes
    // but this deployable's `persistence:` adapter does not yet.
    for (const r of ADAPTER_REFUSALS) {
      if (platformFamily(d.platform) !== r.family || d.persistence !== r.persistence) continue;
      for (const ctxName of d.contextNames) {
        const ctx = ctxByName.get(ctxName);
        if (!ctx) continue;
        for (const use of BACKEND_DETECTORS[r.construct](ctx, sys, d)) {
          refuse(diags, r.verdict.slug, use, d, `${d.platform} (persistence: ${r.persistence})`);
        }
      }
    }
  }
}

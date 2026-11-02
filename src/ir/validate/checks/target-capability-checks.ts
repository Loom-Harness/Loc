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
import {
  BACKEND_CONSTRUCTS,
  type BackendConstruct,
  backendCapability,
  type CapabilityVerdict,
  type RefusableUiConstruct,
  type TargetRefusalSlug,
  UI_CONSTRUCTS,
  uiCapability,
} from "../../../util/target-capabilities.js";
import type {
  BoundedContextIR,
  DeployableIR,
  ExprIR,
  Platform,
  SystemIR,
  UiIR,
} from "../../types/loom-ir.js";
import type { OriginRef } from "../../types/origin.js";
import { bodyUsesChart } from "../../util/chart.js";
import { dataGridHosts } from "../../util/data-grid.js";
import { entityHistoryReadHosts } from "../../util/entity-history-read.js";
import { aggregateIsEventSourced } from "../../util/resolve-datasource.js";
import type { LoomDiagnostic } from "./diagnostic.js";
import { mountedUis, standardOpAwaitUses } from "./ui-framework-checks.js";

/** One use of a construct: where it sits, and the message parameters its
 *  refusal names besides the deployable and target. */
export interface ConstructUse {
  readonly what: string;
  readonly source: string;
  readonly origin?: OriginRef;
}

type UiDetector = (ui: UiIR, sys: SystemIR) => ConstructUse[];
type BackendDetector = (ctx: BoundedContextIR, sys: SystemIR) => ConstructUse[];

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
};

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
  (knob: "ttl" | "keyPrefix" | "every" | "retain" | "readonly"): BackendDetector =>
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
  "resource:replica@resource": (ctx, sys) =>
    resourceUses(ctx, sys, (ds) =>
      ds.kind === "replica" ? `kind: replica, storage '${ds.storageName}'` : undefined,
    ),
  "resource:cache@resource": kindUses("cache"),
  "resource:snapshot@resource": kindUses("snapshot"),
  "knob:ttl@resource": knobUses("ttl"),
  "knob:keyPrefix@resource": knobUses("keyPrefix"),
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
};

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
}

const SHIPPED_TABLE: CapabilityLookup = { ui: uiCapability, backend: backendCapability };

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
        for (const use of BACKEND_DETECTORS[construct](ctx, sys)) {
          if (SYSTEM_SCOPED.has(construct)) {
            const key = `${construct}|${use.source}`;
            if (seen.has(key)) continue;
            seen.add(key);
          }
          refuse(diags, v.slug, use, d, d.platform);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The EVOLUTION family of the toolkit — the transport-neutral core behind the
// `loom_snapshot` and `loom_diff` agent tools (and reusable by any surface).
//
// The playground's Migrations dock tab makes schema migrations, wire-contract
// drift, and provenance snapshots VISIBLE to a human editing a model.  These
// two functions give an AGENT editing a model the same evolution signals,
// riding the SAME pure cores the dock does — `captureSnapshots`,
// `evolveSystem` (`src/system/migration-diff.ts`), `renderPgStep`.  All are
// browser-safe (the build worker imports them too), so this module keeps the
// toolkit's no-Node-only invariant.
//
// Scope note: like every other toolkit verb `snapshot` and `diff` take a SINGLE
// `.ddd` source string.  `diff` is the two-source counterpart of the dock's
// baseline picker: `baseline` is the previous `.ddd`, `current` is the new one.
// `diffModels` is the same diff over already-enriched models, which is how
// `ddd diff` covers a multi-file project: the CLI loads each side's import
// graph from disk (or from git) and hands the models here, so the CLI and
// `loom_diff` classify by one core.
// ---------------------------------------------------------------------------

import { EmptyFileSystem, type LangiumDocument, URI } from "langium";
import type { Diagnostic } from "vscode-languageserver-types";
import type { JsonDiagnostic } from "../diagnostics/contract.js";
import { diagMessage } from "../diagnostics/messages.js";
import { renderPgStep } from "../generator/sql-pg.js";
import { enrichLoomModel } from "../ir/enrich/enrichments.js";
import { lowerModel, mergeLoomModels } from "../ir/lower/lower.js";
import type { EnrichedLoomModel } from "../ir/types/loom-ir.js";
import { createDddServices } from "../language/ddd-module.js";
import type { Model } from "../language/generated/ast.js";
import { captureSnapshots } from "../system/loomsnap.js";
import { headSnapshots, MigrationChainError, parseChain } from "../system/migration-chain.js";
import { evolveSystem, wireChangeEntity } from "../system/migration-diff.js";
import type { SnapshotStore } from "../system/snapshot.js";
import type { WireContractChange } from "../system/wire-spec-diff.js";
import { langiumDiagnosticToJson } from "./report.js";

type EnrichedSystemIR = EnrichedLoomModel["systems"][number];

/** One captured provenance-rule snapshot file (the `ddd snapshot` output). */
export interface SnapshotFile {
  /** Relative artifact path, e.g. `.loom/snapshots/<ts>-<guid>.loomsnap.json`. */
  path: string;
  /** The immutable snapshot JSON. */
  content: string;
}

/** Result of a provenance-snapshot capture — the toolkit twin of `ddd snapshot`
 *  and the playground's snapshot button.  `files` is empty (with `ok: true`)
 *  when the model writes no `provenanced` field, so there is nothing to snapshot. */
export interface SnapshotReport {
  ok: boolean;
  files: SnapshotFile[];
  diagnostics: JsonDiagnostic[];
}

/** One derived schema-migration step, rendered to Postgres SQL for display. */
export interface MigrationStepView {
  op: string;
  sql: string;
}

/** How a change lands on the parties that already depend on the model:
 *  - `compatible` — every existing client and every stored row stays valid;
 *  - `breaking-for-clients` — the wire contract moved under an existing client
 *    (a field dropped, renamed or retyped — an enum member removed, a carrier
 *    narrowed — or tightened from optional to required);
 *  - `breaking-for-data` — the schema migration loses or refuses existing data
 *    (the phase-⑨ destructive gate: a drop, a NOT NULL add with nothing to
 *    fill it, a narrowing column type, a reshape). */
export type ChangeClass = "compatible" | "breaking-for-clients" | "breaking-for-data";

/** One derived schema migration a source change implies, per owning module. */
export interface MigrationView {
  module: string;
  /** Human-readable name — `"Initial"` on first run, `"AddOrderStatus"` etc. */
  name: string;
  steps: MigrationStepView[];
  /** True when the destructive gate refuses the delta — the
   *  `--allow-destructive` gate. */
  destructive: boolean;
  /** The gate's refusal message when `destructive`. */
  destructiveMessage?: string;
  /** `breaking-for-data` exactly when `destructive`. */
  class: Extract<ChangeClass, "compatible" | "breaking-for-data">;
}

/** One wire-contract change from baseline → current, classified breaking. */
export interface WireChangeView {
  /** `"aggregate Order"` / `"value object Money"` etc. */
  entity: string;
  field?: string;
  kind: string;
  /** True under consumer-compatibility semantics (a removed/retyped field). */
  breaking: boolean;
  /** `breaking-for-clients` exactly when `breaking`. */
  class: Extract<ChangeClass, "compatible" | "breaking-for-clients">;
  detail?: string;
  /** The prior rendering (a wire type tag, `optional`, an old name), when the
   *  change replaces a value — e.g. `enum(New|Paid|Lost)`. */
  from?: string;
  /** The new rendering, alongside `from`. */
  to?: string;
}

/** Result of an evolution diff — the migration + wire-contract delta a change
 *  implies.  `breaking` is true on ANY breaking wire change OR destructive
 *  migration (the single red-flag the human dock surfaces as a red dot);
 *  `breakingForClients` / `breakingForData` split it by who breaks. */
export interface DiffReport {
  ok: boolean;
  /** False when no usable baseline was supplied/loadable — every shape reads
   *  "Initial" and the wire diff is skipped as all-new noise. */
  hasBaseline: boolean;
  migrations: MigrationView[];
  wireChanges: WireChangeView[];
  breaking: boolean;
  /** Any wire change is `breaking-for-clients`. */
  breakingForClients: boolean;
  /** Any migration is `breaking-for-data`. */
  breakingForData: boolean;
  diagnostics: JsonDiagnostic[];
}

/** A report that derived nothing — the shape every early return shares. */
function emptyReport(ok: boolean, hasBaseline: boolean, diagnostics: JsonDiagnostic[]): DiffReport {
  return {
    ok,
    hasBaseline,
    migrations: [],
    wireChanges: [],
    breaking: false,
    breakingForClients: false,
    breakingForData: false,
    diagnostics,
  };
}

interface ParsedSource {
  doc: LangiumDocument<Model>;
  model: Model | undefined;
  diagnostics: Diagnostic[];
}

/** Parse a `.ddd` source in-memory on a fresh, isolated service instance —
 *  browser-safe (EmptyFileSystem), mirroring `src/api/index.ts`'s parseSource. */
async function parseSource(source: string): Promise<ParsedSource> {
  const services = createDddServices(EmptyFileSystem);
  const factory = services.shared.workspace.LangiumDocumentFactory;
  const doc = factory.fromString<Model>(source, URI.parse("memory:///source.ddd"));
  await services.shared.workspace.DocumentBuilder.build([doc], { validation: true });
  return {
    doc,
    model: doc.parseResult.value as Model | undefined,
    diagnostics: [...(doc.diagnostics ?? [])],
  };
}

function hasParseError(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((d) => {
    const code = (d.data as { code?: string } | undefined)?.code;
    return d.severity === 1 && (code === "parsing-error" || code === "lexing-error");
  });
}

/** Any error-severity diagnostic (parse OR validation).  A migration/wire diff
 *  derived from an invalid model is meaningless, so `diff` blocks on this —
 *  matching the playground worker's evolution path (`runEvolution` bails on any
 *  error diagnostic).  Use `loom_validate` to repair first. */
function hasErrors(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 1);
}

/** Lower + enrich a single parsed source to the enriched IR (the same phases
 *  `generate`/`readModel` run), surfacing a lowering throw as `null`. */
function lowerEnriched(model: Model): EnrichedLoomModel | null {
  try {
    return enrichLoomModel(mergeLoomModels([lowerModel(model)]));
  } catch {
    return null;
  }
}

function loweringDiag(message: string): JsonDiagnostic {
  return {
    code: "loom.ir-internal",
    severity: "error",
    phase: "ir-validate",
    message,
  };
}

/**
 * Capture provenance rule snapshots for a `.ddd` source — the toolkit twin of
 * the CLI `ddd snapshot` prebuild step and the playground's snapshot button.
 * Returns the immutable `.loom/snapshots/*.loomsnap.json` files; `files` is
 * empty (still `ok: true`) when the model has no written `provenanced` field.
 */
export async function snapshot(source: string): Promise<SnapshotReport> {
  const { doc, model, diagnostics } = await parseSource(source);
  const json = diagnostics.map((d) => langiumDiagnosticToJson(d, doc));
  if (!model || hasParseError(diagnostics)) {
    return { ok: false, files: [], diagnostics: json };
  }
  const loom = lowerEnriched(model);
  if (!loom) {
    return {
      ok: false,
      files: [],
      diagnostics: [...json, loweringDiag(diagMessage("loom.ir-internal#snapshot-lowering"))],
    };
  }
  const files = [...captureSnapshots(loom)].map(([path, content]) => ({ path, content }));
  return { ok: true, files, diagnostics: json };
}

/** Fold each declared rename (a `migration` block's `Agg.old -> new` or
 *  `Old -> New`) into the wire diff: the removed-plus-added pair it produced
 *  becomes ONE `property-renamed` / `entity-renamed` change.  Still breaking
 *  for clients — no backend keeps serving the old wire name — but reported as
 *  the rename it is, not as an unrelated drop and add. */
function foldDeclaredRenames(
  changes: readonly WireContractChange[],
  cur: EnrichedLoomModel,
): WireContractChange[] {
  const out = [...changes];
  const isAgg = (entity: string, agg: string, ctx: string) =>
    entity === agg || entity === `${ctx}.${agg}`;
  const replacePair = (
    removed: WireContractChange,
    added: WireContractChange,
    renamed: WireContractChange,
  ) => {
    out.splice(out.indexOf(removed), 1);
    out[out.indexOf(added)] = renamed;
  };
  for (const r of cur.renameIntents) {
    const at = (c: WireContractChange) =>
      c.bucket === "aggregates" && isAgg(c.entity, r.aggregate, r.context);
    const removed = out.find((c) => at(c) && c.kind === "property-removed" && c.field === r.from);
    const added = out.find(
      (c) =>
        at(c) &&
        (c.kind === "property-added-optional" || c.kind === "property-added-required") &&
        c.field === r.to,
    );
    if (!removed || !added) continue;
    replacePair(removed, added, {
      kind: "property-renamed",
      breaking: true,
      bucket: added.bucket,
      entity: added.entity,
      field: r.to,
      detail: `property '${r.from}' on ${added.entity} renamed to '${r.to}' (declared in migration "${r.migration}")`,
      from: r.from,
      to: r.to,
    });
  }
  for (const r of cur.tableRenameIntents) {
    const removed = out.find(
      (c) =>
        c.bucket === "aggregates" &&
        c.kind === "entity-removed" &&
        isAgg(c.entity, r.fromAggregate, r.context),
    );
    const added = out.find(
      (c) =>
        c.bucket === "aggregates" &&
        c.kind === "entity-added" &&
        isAgg(c.entity, r.toAggregate, r.context),
    );
    if (!removed || !added) continue;
    replacePair(removed, added, {
      kind: "entity-renamed",
      breaking: true,
      bucket: "aggregates",
      entity: added.entity,
      detail: `aggregate '${removed.entity}' renamed to '${added.entity}' (declared in migration "${r.migration}")`,
      from: removed.entity,
      to: added.entity,
    });
  }
  return out;
}

/** The toolkit's view of one system's evolution — the modules with steps,
 *  rendered to Postgres SQL and classified, and the wire changes with each
 *  declared rename folded in. */
function diffSystems(
  cur: EnrichedLoomModel,
  curSys: EnrichedSystemIR,
  baseSys: EnrichedSystemIR | null,
  chainHeads: SnapshotStore | null,
): { migrations: MigrationView[]; wireChanges: WireChangeView[] } {
  const evo = evolveSystem(cur, curSys, baseSys, chainHeads);
  const migrations: MigrationView[] = evo.deltas
    .filter((mig) => mig.steps.length > 0)
    .map((mig) => {
      const destructiveMessage = evo.destructive.get(mig.module);
      return {
        module: mig.module,
        name: mig.name,
        steps: mig.steps.map((s) => ({ op: s.op, sql: renderPgStep(s) })),
        destructive: destructiveMessage !== undefined,
        destructiveMessage,
        class: destructiveMessage !== undefined ? "breaking-for-data" : "compatible",
      };
    });
  const wireChanges: WireChangeView[] = foldDeclaredRenames(evo.wire?.changes ?? [], cur).map(
    (c) => ({
      entity: wireChangeEntity(c),
      field: c.field,
      kind: c.kind,
      breaking: c.breaking,
      class: c.breaking ? "breaking-for-clients" : "compatible",
      detail: c.detail,
      from: c.from,
      to: c.to,
    }),
  );
  return { migrations, wireChanges };
}

/**
 * The evolution diff between a `baseline` `.ddd` source and the `current` one —
 * the schema migrations the change implies (per owning module, rendered to
 * Postgres SQL, with the destructive-data-loss gate surfaced) plus the wire-
 * contract delta, each change classified `compatible` / `breaking-for-clients`
 * / `breaking-for-data`.  The toolkit twin of the playground's Migrations dock
 * tab and of `ddd diff`, at single-source granularity.
 *
 * `baseline` omitted/empty ⇒ every system reads "Initial" (`hasBaseline: false`,
 * wire diff skipped).  `migrations` — the files of a committed `migrations/`
 * directory — makes the chain's heads the schema baseline instead, so the
 * migrations reported are exactly what `ddd migrate add` would record (the
 * wire diff still needs `baseline`).  A broken `current` source, a `baseline`
 * that does not load, or a chain that does not read returns `ok: false` with
 * diagnostics: a gate must never answer `breaking: false` against nothing.
 */
export async function diff(
  current: string,
  baseline?: string,
  migrationFiles?: ReadonlyArray<{ name: string; content: string }>,
): Promise<DiffReport> {
  const cur = await parseSource(current);
  const curJson = cur.diagnostics.map((d) => langiumDiagnosticToJson(d, cur.doc));
  if (!cur.model || hasErrors(cur.diagnostics)) return emptyReport(false, false, curJson);
  const curLoom = lowerEnriched(cur.model);
  if (!curLoom) {
    return emptyReport(false, false, [
      ...curJson,
      loweringDiag(diagMessage("loom.ir-internal#evolve-lowering")),
    ]);
  }

  // Load the baseline if given.  One that does not load is an error, never
  // "no baseline": the diff against nothing reads every change as additive.
  let baseLoom: EnrichedLoomModel | null = null;
  if (baseline && baseline.trim().length > 0) {
    const base = await parseSource(baseline);
    baseLoom = base.model && !hasErrors(base.diagnostics) ? lowerEnriched(base.model) : null;
    if (!baseLoom) {
      const errors = base.diagnostics
        .filter((d) => d.severity === 1)
        .map((d) => langiumDiagnosticToJson(d, base.doc).message);
      return emptyReport(false, true, [
        ...curJson,
        baselineInvalid(errors.length > 0 ? errors.slice(0, 3).join(" | ") : "it does not lower"),
      ]);
    }
  }
  const report = diffModels(curLoom, baseLoom, migrationFiles);
  return { ...report, diagnostics: [...curJson, ...report.diagnostics] };
}

/** The `loom.diff-baseline-invalid` refusal. */
function baselineInvalid(detail: string): JsonDiagnostic {
  return {
    code: "loom.diff-baseline-invalid",
    severity: "error",
    phase: "ir-validate",
    message: diagMessage("loom.diff-baseline-invalid", { detail }),
  };
}

/**
 * {@link diff} over models the caller already parsed, lowered and enriched —
 * the entry a host with a filesystem uses, so a multi-file project (its whole
 * `import` graph) diffs exactly as a single source does.  `baseline` null and
 * no `migrationFiles` ⇒ `hasBaseline: false`.  The returned diagnostics carry
 * only what the diff itself raised.
 */
export function diffModels(
  current: EnrichedLoomModel,
  baseline: EnrichedLoomModel | null,
  migrationFiles?: ReadonlyArray<{ name: string; content: string }>,
): DiffReport {
  if (current.systems.length === 0) {
    return emptyReport(true, false, [
      {
        code: "loom.no-system",
        severity: "warning",
        phase: "ir-validate",
        message: diagMessage("loom.no-system"),
      },
    ]);
  }
  const baseSystemsByName = new Map((baseline?.systems ?? []).map((s) => [s.name, s]));

  // The committed chain, when given, is the schema baseline.
  let chainHeads: SnapshotStore | null = null;
  if (migrationFiles !== undefined) {
    try {
      chainHeads = headSnapshots(parseChain(migrationFiles));
    } catch (err) {
      if (!(err instanceof MigrationChainError)) throw err;
      return emptyReport(false, true, [
        {
          code: "loom.migration-chain-invalid",
          severity: "error",
          phase: "ir-validate",
          message: diagMessage("loom.migration-chain-invalid", { detail: err.message }),
        },
      ]);
    }
  }
  const hasBaseline = baseSystemsByName.size > 0 || chainHeads !== null;

  const migrations: MigrationView[] = [];
  const wireChanges: WireChangeView[] = [];
  try {
    for (const curSys of current.systems) {
      const r = diffSystems(
        current,
        curSys,
        baseSystemsByName.get(curSys.name) ?? null,
        chainHeads,
      );
      migrations.push(...r.migrations);
      wireChanges.push(...r.wireChanges);
    }
  } catch (err) {
    return emptyReport(false, hasBaseline, [
      loweringDiag(
        diagMessage("loom.ir-internal#migration-derivation", {
          message: err instanceof Error ? err.message : String(err),
        }),
      ),
    ]);
  }

  const breakingForClients = wireChanges.some((c) => c.breaking);
  const breakingForData = migrations.some((m) => m.destructive);
  return {
    ok: true,
    hasBaseline,
    migrations,
    wireChanges,
    breaking: breakingForClients || breakingForData,
    breakingForClients,
    breakingForData,
    diagnostics: [],
  };
}

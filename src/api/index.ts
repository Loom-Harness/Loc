// ---------------------------------------------------------------------------
// The Loom toolkit API — transport-neutral operations over a `.ddd` source.
//
// One core, many transports: the CLI, the (future) MCP server, the LSP
// adapters, and the in-browser playground all call these same functions, so
// the operation set never drifts per surface.  Everything here parses
// in-memory on EmptyFileSystem (no Node-only imports) and returns the contract
// wire shapes from `src/diagnostics/contract.ts`.
//
// Operations:
//   validate(source)      → ValidateReport   (diagnostics + outline)
//   generate(source)      → GenerateReport   (validation + deployable manifest)
//   applyPatches(src, ps) → PatchResult      (re-exported from language/)
// ---------------------------------------------------------------------------

import type { LangiumDocument } from "langium";
import type { Diagnostic } from "vscode-languageserver-types";
import type {
  GenerateReport,
  ModelAggregate,
  ModelView,
  Outline,
  PrimitiveCatalog,
  ValidateReport,
} from "../diagnostics/contract.js";
import { diagMessage } from "../diagnostics/messages.js";
import { enrichLoomModel } from "../ir/enrich/enrichments.js";
import { wireFieldsForAggregate } from "../ir/enrich/wire-projection.js";
import { lowerModel, mergeLoomModels } from "../ir/lower/lower.js";
import type { EnrichedBoundedContextIR } from "../ir/types/loom-ir.js";
import { typeLabel } from "../ir/util/type-label.js";
import { IR_ILL_FORMED_CODE } from "../ir/validate/checks/lowering-checks.js";
import { UNRESOLVED_TYPE_CODE } from "../ir/validate/checks/unresolved-type-checks.js";
import {
  type LoomDiagnostic,
  type ValidateLoomModelOptions,
  validateLoomModel,
} from "../ir/validate/validate.js";
import type { Model } from "../language/generated/ast.js";
import { buildOutline } from "../language/print/index.js";
import { withSharedDocument } from "../language/shared-services.js";
import { WALKER_LAYOUT_PRIMITIVES, WALKER_SUB_PRIMITIVES } from "../util/walker-primitive-names.js";
import {
  buildGenerateReport,
  buildValidateReport,
  irDiagnosticToJson,
  langiumDiagnosticToJson,
} from "./report.js";

export type {
  EditError,
  EditResult,
  FindSymbolResult,
  GenerateReport,
  HoverResult,
  JsonDiagnostic,
  ModelAggregate,
  ModelDeployable,
  ModelSystem,
  ModelView,
  ModelWireField,
  NavError,
  NavLocation,
  NavSymbol,
  NavTextEdit,
  Outline,
  PrimitiveCatalog,
  QuickfixResult,
  ReferencesResult,
  RenameResult,
  UnfoldMacroResult,
  ValidateReport,
} from "../diagnostics/contract.js";
export type {
  ModelPatch,
  PatchApplied,
  PatchError,
  PatchResult,
  PatchTextEdit,
} from "../language/model-patch.js";
export { applyPatches, resolvePatchEdits } from "../language/model-patch.js";
export type {
  ChangeClass,
  DiffReport,
  MigrationStepView,
  MigrationView,
  SnapshotFile,
  SnapshotReport,
  WireChangeView,
} from "./evolve.js";
export { diff, diffModels, snapshot } from "./evolve.js";
export { fixHintCodeActions, toLspDiagnostic, toLspDiagnostics } from "./lsp.js";
export type {
  ChainFile,
  MigrationStatusReport,
  ModuleMigrationStatus,
  RecordedFile,
  RecordMigrationOptions,
  RecordMigrationReport,
} from "./migrate.js";
export {
  migrationStatus,
  migrationStatusModels,
  recordMigration,
  recordMigrationModels,
} from "./migrate.js";
export { findSymbol, hover, references } from "./navigate.js";
export { quickfix, rename, unfoldMacro } from "./refactor.js";
export { LOOM_VERSION } from "./report.js";

interface ParsedSource {
  doc: LangiumDocument<Model>;
  model: Model | undefined;
  diagnostics: Diagnostic[];
}

/** Parse a `.ddd` source in-memory (lex → parse → link → AST-validate) on the
 *  shared service set and run `fn` while the document is live.  The document is
 *  removed afterwards, so `fn` must finish all AST/IR work before returning.
 *  Browser-safe (EmptyFileSystem). */
function withParsed<T>(source: string, fn: (parsed: ParsedSource) => Promise<T> | T): Promise<T> {
  return withSharedDocument(
    source,
    ({ doc }) =>
      fn({
        doc,
        model: doc.parseResult.value as Model | undefined,
        diagnostics: [...(doc.diagnostics ?? [])],
      }),
    { validation: true },
  );
}

/** A parse/lex error means the AST is incomplete and lowering can throw —
 *  callers skip the IR phases when this is true (contract §6). */
function hasParseError(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((d) => {
    const code = (d.data as { code?: string } | undefined)?.code;
    return d.severity === 1 && (code === "parsing-error" || code === "lexing-error");
  });
}

/** `loom.unresolved-type` and `loom.ir-ill-formed` are the backstops for a
 *  model nothing else refuses (`unresolved-type-checks.ts`,
 *  `lowering-checks.ts`); the IR layer cannot see the AST layer's
 *  errors, so a host holding both drops it when one of those already does. */
function withoutUnresolvedBackstop(langium: Diagnostic[], ir: LoomDiagnostic[]): LoomDiagnostic[] {
  if (!langium.some((d) => d.severity === 1)) return ir;
  return ir.filter((d) => d.code !== UNRESOLVED_TYPE_CODE && d.code !== IR_ILL_FORMED_CODE);
}

/** Run the IR phases (lower → enrich → IR-validate) over a parsed model,
 *  surfacing an internal failure as a single diagnostic rather than throwing. */
function irDiagnosticsFor(
  model: Model,
  path: string,
  options: ValidateLoomModelOptions,
): LoomDiagnostic[] {
  try {
    return validateLoomModel(enrichLoomModel(mergeLoomModels([lowerModel(model)])), options);
  } catch (err) {
    return [
      {
        severity: "error",
        message: diagMessage("loom.ir-internal#generation", {
          err: err instanceof Error ? err.message : String(err),
        }),
        source: path,
        code: "loom.ir-internal",
      },
    ];
  }
}

/** Options shared by `validate()` / `generate()`. */
export interface ToolkitOptions {
  /** The path reported as the diagnostics' source. */
  path?: string;
  /** Reads a custom `design:` pack so phase ⑦ can check it.  The source is
   *  parsed in memory, so the toolkit never touches a filesystem itself: a
   *  Node host passes `fsDesignPackInspector(<the .ddd's dir>)`; without one,
   *  custom packs are not inspected. */
  designPacks?: ValidateLoomModelOptions["designPacks"];
}

/**
 * Validate a `.ddd` source — the `parse --json` / `validate --json` contract.
 * Runs the Langium phases AND the IR validator and returns the full
 * `ValidateReport` (coded, phase-attributed diagnostics + the outline).
 */
export async function validate(source: string, opts: ToolkitOptions = {}): Promise<ValidateReport> {
  const path = opts.path ?? "<source>";
  return withParsed(source, ({ doc, model, diagnostics }) => {
    const irDiagnostics =
      model && !hasParseError(diagnostics)
        ? withoutUnresolvedBackstop(
            diagnostics,
            irDiagnosticsFor(model, path, { designPacks: opts.designPacks }),
          )
        : [];
    return buildValidateReport({
      modelPath: path,
      langiumDiagnostics: diagnostics,
      doc,
      irDiagnostics,
      model,
    });
  });
}

/**
 * The model's `outline` — the address book of contexts / aggregates / members
 * (the targets a `ModelPatch` and a diagnostic `node` use).  Cheap: parse +
 * walk, no IR phases.  Always returns a valid object.
 */
export async function outline(source: string): Promise<Outline> {
  return withParsed(source, ({ model }) => {
    if (!model) return { systems: [], contexts: [] };
    try {
      return buildOutline(model);
    } catch {
      return { systems: [], contexts: [] };
    }
  });
}

/**
 * Validation + deployable manifest for a `.ddd` source — the `generate --json`
 * contract (§4).  Reports whether the model would generate and which
 * deployables (name / platform / port) it produces; it does not write files
 * (use the CLI `generate system -o` to emit a tree).
 */
export async function generate(source: string, opts: ToolkitOptions = {}): Promise<GenerateReport> {
  const path = opts.path ?? "<source>";
  return withParsed(source, ({ doc, model, diagnostics }) => {
    const langiumJson = diagnostics.map((d) => langiumDiagnosticToJson(d, doc));

    if (!model || hasParseError(diagnostics)) {
      return buildGenerateReport({ modelPath: path, diagnostics: langiumJson, deployables: [] });
    }

    const loom = enrichLoomModel(mergeLoomModels([lowerModel(model)]));
    const irJson = withoutUnresolvedBackstop(
      diagnostics,
      validateLoomModel(loom, { designPacks: opts.designPacks }),
    ).map((d) => irDiagnosticToJson(d, doc));
    const deployables = loom.systems.flatMap((sys) =>
      sys.deployables.map((d) => ({ name: d.name, platform: d.platform, port: d.port })),
    );
    return buildGenerateReport({
      modelPath: path,
      diagnostics: [...langiumJson, ...irJson],
      deployables,
    });
  });
}

/** Project a bounded context's aggregates to their resolved wire shape. */
function aggregatesOf(ctx: EnrichedBoundedContextIR): ModelAggregate[] {
  return ctx.aggregates.map((agg) => ({
    name: agg.name,
    context: ctx.name,
    // The canonical wire shape is DERIVED on demand (never stamped) — the same
    // `wireFieldsForAggregate` every backend's DTO emitter consumes.
    wire: wireFieldsForAggregate(agg).map((f) => ({
      name: f.name,
      type: typeLabel(f.type),
      optional: f.optional,
      source: f.source,
    })),
  }));
}

/**
 * The resolved model view — the ENRICHED IR projected to the wire contract an
 * agent reasons about: each system's deployable manifest plus every aggregate's
 * canonical `wireShape` (id → properties → containments → derived, with each
 * field's rendered type / optionality / provenance).  This is the semantic
 * layer the AST-level {@link outline} deliberately omits.  Runs lower + enrich
 * (like {@link generate}); returns an empty view when the source can't lower.
 */
export async function readModel(source: string): Promise<ModelView> {
  return withParsed(source, ({ model, diagnostics }) => {
    if (!model || hasParseError(diagnostics)) return { systems: [], contexts: [] };
    return modelViewOf(model);
  });
}

function modelViewOf(model: Model): ModelView {
  let loom: ReturnType<typeof enrichLoomModel>;
  try {
    loom = enrichLoomModel(mergeLoomModels([lowerModel(model)]));
  } catch {
    return { systems: [], contexts: [] };
  }
  return {
    systems: loom.systems.map((sys) => ({
      name: sys.name,
      deployables: sys.deployables.map((d) => ({
        name: d.name,
        platform: d.platform,
        port: d.port,
      })),
      // A system's contexts live under its subdomains (top-level members fold
      // into the lone system as subdomains during lowering).
      aggregates: sys.subdomains.flatMap((sd) => sd.contexts).flatMap(aggregatesOf),
    })),
    // Top-level loose contexts (single-deployable legacy shape) keep their
    // per-context grouping.
    contexts: loom.contexts.map((ctx) => ({ name: ctx.name, aggregates: aggregatesOf(ctx) })),
  };
}

/**
 * The closed page-body primitive vocabulary the UI walker admits — the exact
 * set an agent may use as `BuilderCall` types in a `page`/component body
 * without declaring a domain type.  Static (no source input): sourced from the
 * walker registry's admissibility sets, so it can't drift from what the
 * validator accepts.  Sorted for stable output.
 */
export function listPrimitives(): PrimitiveCatalog {
  return {
    layout: [...WALKER_LAYOUT_PRIMITIVES].sort(),
    sub: [...WALKER_SUB_PRIMITIVES].sort(),
  };
}

// On-demand rendering — any generated file, or any hatch stub, without
// writing anything.  The toolkit twin of `ddd render`.
//
// Generation is deterministic, so what the model renders now can be compared
// with what is on disk: a person or an agent asks for the fresh content of one
// path (a generated file, or the stub of a hatch file the model calls for) and
// diffs it against the file they have — for example to carry a renamed or
// re-signed `extern` hook into their implementation.  Hatch entries carry the
// expected signatures as target-neutral `.ddd` text, rendered from the model;
// nothing here reads or inspects the user's files.

import type { JsonDiagnostic } from "../diagnostics/contract.js";
import type { EnrichedLoomModel } from "../ir/types/loom-ir.js";
import { type HatchKind, hatchContracts } from "../ir/util/hatch-contract.js";
import { generateSystemsFromLoom, type SystemEmission } from "../system/index.js";
import type { HatchFile } from "../util/hatch.js";
import { loadMigratableSource } from "./evolve.js";
import { type ChainFile, readChain } from "./migrate.js";

/** Inputs every render call shares: the committed `migrations/` chain, so a
 *  migration file renders exactly as `ddd generate system` writes it.  Omit
 *  when the model has no chain yet. */
export interface RenderOptions {
  migrations?: readonly ChainFile[];
}

export interface RenderFileReport {
  ok: boolean;
  path: string;
  /** `generated`: a file `generate` writes; `hatch-stub`: the stub of a hatch
   *  file (yours once it exists); `absent`: the model produces no such path. */
  role: "generated" | "hatch-stub" | "absent";
  /** The construct a hatch file belongs to (`Ctx.Agg` / `Ctx.Handler`). */
  owner?: string;
  content?: string;
  diagnostics: JsonDiagnostic[];
}

export interface HatchView {
  owner: string;
  kind: HatchKind;
  /** Output-relative path, as `generate system -o` lays it out. */
  path: string;
  /** What the file is expected to implement, one `.ddd` signature per hook. */
  signatures: string[];
  /** `present` / `pending`, when the caller said which paths exist. */
  state?: "present" | "pending";
  /** The stub `ddd scaffold` writes when the file is missing. */
  stub: string;
}

export interface HatchesReport {
  ok: boolean;
  hatches: HatchView[];
  diagnostics: JsonDiagnostic[];
}

type Rendered = {
  emission: SystemEmission;
  loom: EnrichedLoomModel;
  diagnostics: JsonDiagnostic[];
};

async function renderAll(
  source: string,
  opts: RenderOptions,
): Promise<Rendered | { error: JsonDiagnostic[] }> {
  const loaded = await loadMigratableSource(source);
  if ("error" in loaded) return { error: loaded.error };
  const read = readChain(opts.migrations);
  if ("error" in read) return { error: [read.error] };
  const emission = generateSystemsFromLoom(loaded.loom, {
    ...(opts.migrations ? { migrationChain: read.chain } : {}),
    unrecordedChanges: "render-chain",
  });
  return { emission, loom: loaded.loom, diagnostics: loaded.diagnostics };
}

/** The fresh content of one output path: a generated file or a hatch stub. */
export async function renderFile(
  source: string,
  path: string,
  opts: RenderOptions = {},
): Promise<RenderFileReport> {
  const r = await renderAll(source, opts);
  if ("error" in r) return { ok: false, path, role: "absent", diagnostics: r.error };
  const generated = r.emission.files.get(path);
  if (generated !== undefined) {
    return { ok: true, path, role: "generated", content: generated, diagnostics: r.diagnostics };
  }
  const hatch = r.emission.hatches.get(path);
  if (hatch !== undefined) {
    return {
      ok: true,
      path,
      role: "hatch-stub",
      owner: hatch.owner,
      content: hatch.stub,
      diagnostics: r.diagnostics,
    };
  }
  return { ok: true, path, role: "absent", diagnostics: r.diagnostics };
}

/** Every hatch file the model calls for, with its expected signatures and
 *  fresh stub.  `existing` (output-relative paths that exist) adds a state. */
export async function hatches(
  source: string,
  opts: RenderOptions & { existing?: readonly string[] } = {},
): Promise<HatchesReport> {
  const r = await renderAll(source, opts);
  if ("error" in r) return { ok: false, hatches: [], diagnostics: r.error };
  return {
    ok: true,
    hatches: hatchViews(r.emission.hatches, r.loom, opts.existing),
    diagnostics: r.diagnostics,
  };
}

/** The hatch list of an emission, sorted by path.  Shared with the CLI. */
export function hatchViews(
  hatchFiles: ReadonlyMap<string, HatchFile>,
  loom: EnrichedLoomModel,
  existing?: readonly string[],
): HatchView[] {
  const contracts = hatchContracts(loom);
  const on = existing ? new Set(existing) : undefined;
  return [...hatchFiles]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, h]) => {
      const c = contracts.get(h.owner);
      // Every stub is tagged with a key `hatchContracts` derives; a miss is a
      // compiler defect, not a model error.
      if (!c) throw new Error(`hatch ${path}: no extern construct named ${h.owner}`);
      return {
        owner: h.owner,
        kind: c.kind,
        path,
        signatures: [...c.signatures],
        ...(on ? { state: on.has(path) ? ("present" as const) : ("pending" as const) } : {}),
        stub: h.stub,
      };
    });
}

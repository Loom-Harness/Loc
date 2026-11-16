// Every tracked model with a React or Vue frontend, loaded the way
// `ddd generate system` loads it.
//
// The model-equivalence tests compare what a frontend reads off the Frontend
// Contract with what it reads off the enriched IR.  A model split across
// imported files only builds through the project loader, so a test that parsed
// each file on its own would silently skip it.  This loads each tracked `.ddd`
// as the entry of its import graph and keeps the ones that build cleanly.

import * as path from "node:path";
import { URI } from "langium";
import { NodeFileSystem } from "langium/node";
import {
  buildFrontendContract,
  type FrontendContract,
} from "../../src/ir/contract/frontend-contract.js";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerProject } from "../../src/ir/lower/lower.js";
import type {
  BoundedContextIR,
  EnrichedLoomModel,
  EnrichedSystemIR,
} from "../../src/ir/types/loom-ir.js";
import { createDddServices } from "../../src/language/ddd-module.js";
import type { Model } from "../../src/language/generated/ast.js";
import { loadProject } from "../../src/language/project-loader.js";
import { dddSourceOf, trackedDddFiles } from "./ddd-corpus.js";

const repoRoot = path.resolve(__dirname, "..", "..");

/** The frontend frameworks that emit from the Frontend Contract. */
export const CONTRACT_FRAMEWORKS: ReadonlySet<string> = new Set(["react", "vue", "svelte"]);

export interface FrontendModel {
  readonly file: string;
  readonly model: EnrichedLoomModel;
}

/** Each tracked `.ddd` outside the corpus that declares a `ui`, built as the
 *  entry of its import graph; one that does not build cleanly is skipped. */
export async function trackedFrontendModels(): Promise<FrontendModel[]> {
  const out: FrontendModel[] = [];
  for (const file of trackedDddFiles()) {
    if (file.startsWith("test/fixtures/corpus/")) continue;
    if (!/\bui\b/.test(dddSourceOf(file))) continue;
    try {
      // One workspace per entry: documents an earlier load registered would
      // otherwise collide with this graph's own declarations.
      const services = createDddServices(NodeFileSystem);
      const { all } = await loadProject(URI.file(path.join(repoRoot, file)), services.shared);
      const errors = all.some((doc) => (doc.diagnostics ?? []).some((d) => d.severity === 1));
      if (errors) continue;
      const model = enrichLoomModel(lowerProject(all.map((doc) => doc.parseResult.value as Model)));
      out.push({ file, model });
    } catch {}
  }
  return out;
}

/** The contexts the system hands a frontend deployable: its own, with every
 *  abstract base dropped except a polymorphic read home (`ownTable`). */
export function frontendContexts(
  sys: EnrichedSystemIR,
  contextNames: readonly string[],
): BoundedContextIR[] {
  const want = new Set(contextNames);
  return sys.subdomains
    .flatMap((sd) => sd.contexts)
    .filter((c) => want.has(c.name))
    .map((c) => ({
      ...c,
      aggregates: c.aggregates.filter((a) => !a.isAbstract || a.inheritanceUsing === "ownTable"),
    })) as BoundedContextIR[];
}

/** One React or Vue frontend deployable of a tracked model. */
export interface ContractFrontendCell {
  readonly file: string;
  readonly deployable: string;
  readonly sys: EnrichedSystemIR;
  readonly contract: FrontendContract;
  readonly contexts: BoundedContextIR[];
}

/** Every React or Vue frontend deployable of every tracked model. */
export async function contractFrontendCells(): Promise<ContractFrontendCell[]> {
  const out: ContractFrontendCell[] = [];
  for (const { file, model } of await trackedFrontendModels()) {
    for (const sys of model.systems) {
      if (sys.uis.length === 0) continue;
      const contract = buildFrontendContract(model, sys);
      for (const d of sys.deployables) {
        if (!d.uiName || !CONTRACT_FRAMEWORKS.has(d.uiFramework ?? "")) continue;
        out.push({
          file,
          deployable: d.name,
          sys,
          contract,
          contexts: frontendContexts(sys, d.contextNames),
        });
      }
    }
  }
  return out;
}

// Loading a `.ddd` project for a CLI command: the multi-file parse, the
// validated-model load, and the small I/O helpers the commands share.

import * as fs from "node:fs";
import * as path from "node:path";
import { URI } from "langium";
import { NodeFileSystem } from "langium/node";
import { fsDesignPackInspector } from "../generator/_packs/loader-fs.js";
import { enrichLoomModel } from "../ir/enrich/enrichments.js";
import { lowerProject } from "../ir/lower/lower.js";
import type { EnrichedLoomModel } from "../ir/types/loom-ir.js";
import { validateLoomModel } from "../ir/validate/validate.js";
import { createDddServices } from "../language/ddd-module.js";
import type { Model } from "../language/generated/ast.js";
import { loadProject } from "../language/project-loader.js";
import type { DesignPackInspector } from "../util/design-pack-defects.js";
import { printAstDiagnostics, printIrDiagnostics, printSummary } from "./report.js";

/** What the CLI host offers phase ⑦ beyond the model: a disk-backed reader
 *  for custom `design:` packs, so a malformed pack is a
 *  `loom.design-pack-invalid` diagnostic on `parse` rather than a crash on
 *  `generate`.  A relative `design:` path resolves against the declaring
 *  `.ddd` file's directory; `file`'s directory covers a model parsed in
 *  memory (the `--json` toolkit path), which carries no file location. */
export function hostValidateOptions(file: string): { designPacks: DesignPackInspector } {
  return { designPacks: fsDesignPackInspector(path.dirname(path.resolve(file))) };
}

export interface ProjectParseResult {
  /** Enriched LoomModel, merged from every reachable document and run
   *  through `enrichLoomModel`.  Branded `EnrichedLoomModel` so the
   *  downstream pipeline (validator, system orchestrator, generators)
   *  type-rejects an un-enriched IR at the call site. */
  loom: EnrichedLoomModel;
  diagnostics: string[];
  errorCount: number;
  warningCount: number;
  /** `.ddd` source text keyed by `URI.path` (the key an `OriginRef`'s
   *  `SourceRef.path` resolves to), over every document in the import graph —
   *  feeds `GenerateSystemOptions.sourceTexts` for Source Map v3 sidecars. */
  sourceTexts: Map<string, string>;
}

/**
 * Multi-file entry — load the project rooted at `entryFile`, walk
 * its `import` graph, and return a single enriched `LoomModel` built
 * by lowering each document independently and merging the results.
 * Used by every command that reads a model.
 */
export async function parseProject(entryFile: string): Promise<ProjectParseResult> {
  const services = createDddServices(NodeFileSystem);
  const absolute = path.resolve(entryFile);
  if (!fs.existsSync(absolute)) {
    throw new Error(`File not found: ${absolute}`);
  }
  const { all } = await loadProject(URI.file(absolute), services.shared);

  const sourceTexts = new Map<string, string>();
  for (const doc of all) sourceTexts.set(doc.uri.path, doc.textDocument.getText());

  const diagnostics: string[] = [];
  let errorCount = 0;
  let warningCount = 0;
  for (const doc of all) {
    const docPath = doc.uri.fsPath;
    for (const d of doc.diagnostics ?? []) {
      const severity = d.severity === 1 ? "error" : d.severity === 2 ? "warning" : "info";
      if (severity === "error") errorCount++;
      if (severity === "warning") warningCount++;
      const line = d.range.start.line + 1;
      const col = d.range.start.character + 1;
      diagnostics.push(`${docPath}:${line}:${col} ${severity}: ${d.message}`);
    }
  }

  // Lower each document independently; references between documents
  // were resolved by the linker during DocumentBuilder.build so each
  // IR node carries fully-resolved cross-doc refs.  The merge is then
  // an in-order concatenation of the top-level slices.
  // `lowerProject` composes the whole import graph as one project — the
  // lone `system { }` block plus top-level `subdomain` / `context`
  // declarations from any file fold into a single system (see
  // https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/proposals/implicit-system-composition.md).
  //
  // LAZY, and only ever forced after the caller has checked `errorCount`.  A
  // document with a parse error carries a RECOVERED AST — a required cross-ref
  // like `apply Opened {`'s `event` is simply absent — and lowering it threw a
  // `TypeError` out of `lowerApply` before the command could print the parse
  // error it had already collected.  Every caller aborts on `errorCount > 0`
  // first, so an erroneous model is never lowered at all.
  const models = all.map((doc) => doc.parseResult.value as Model);
  let loom: EnrichedLoomModel | undefined;
  return {
    get loom() {
      loom ??= enrichLoomModel(lowerProject(models));
      return loom;
    },
    diagnostics,
    errorCount,
    warningCount,
    sourceTexts,
  };
}

/** Read a `.ddd` file, or throw a clear error.  The structured-JSON verbs
 *  operate on a single in-memory source (the toolkit parses it browser-safe);
 *  multi-file `import` resolution stays on the fs-based `generate`/`parse`
 *  paths. */
export function readSource(file: string): { absolute: string; source: string } {
  const absolute = path.resolve(file);
  if (!fs.existsSync(absolute)) {
    throw new Error(`File not found: ${absolute}`);
  }
  return { absolute, source: fs.readFileSync(absolute, "utf8") };
}

/**
 * Run `work` with everything it writes to STDOUT diverted to stderr, and
 * return its result — the guard that keeps a `--json` verb's stdout a single
 * parseable document.
 *
 * A machine-readable stream is a contract with a consumer that will
 * `JSON.parse` it, and that contract is only as strong as the noisiest thing
 * in the process.  It was broken by a source containing `money(`: Chevrotain's
 * ALL(*) lookahead reported a prefix ambiguity between the two `money(` rules
 * through `console.log`, LAZILY, on the first input that reached that
 * alternation — so `generate system --json` printed four lines of grammar
 * advice ahead of the payload and `jq` refused the output.  Nothing in the JSON
 * verbs themselves was wrong, which is the point: the fix has to hold for
 * whatever a dependency decides to print next, not just for this one warning.
 *
 * That particular warning no longer exists — M-T9.60 removed the ambiguity at
 * the source (one grammar path for `money(`; see
 * `src/language/money-literal.ts`), which is also why nothing in-tree exercises
 * this diversion today.  It stays because the contract it enforces was never
 * about Chevrotain.
 *
 * The diverted text is not swallowed — it lands on stderr, where a human
 * still sees it and `2>/dev/null` still silences it.
 */
export async function withJsonStdout<T>(work: () => Promise<T>): Promise<T> {
  const original = process.stdout.write.bind(process.stdout);
  const divert = ((chunk: unknown, encoding?: unknown, callback?: unknown) =>
    (process.stderr.write as (...a: unknown[]) => boolean)(
      chunk,
      encoding,
      callback,
    )) as typeof process.stdout.write;
  process.stdout.write = divert;
  try {
    return await work();
  } finally {
    process.stdout.write = original;
  }
}

/** Parse, validate and print diagnostics for `file` the way `generate`
 *  does; `null` when it has errors (already printed). */
export async function loadValidProject(
  file: string,
  allWarnings: boolean | undefined,
): Promise<EnrichedLoomModel | null> {
  let projectResult: ProjectParseResult;
  try {
    projectResult = await parseProject(file);
  } catch (err) {
    console.error(`${file}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  const ast = printAstDiagnostics(projectResult);
  if (projectResult.errorCount > 0) {
    printSummary(ast);
    return null;
  }
  const loom = projectResult.loom;
  const { errors, warnings } = printIrDiagnostics(
    validateLoomModel(loom),
    projectResult.sourceTexts,
    { allWarnings },
  );
  printSummary(ast, { errors: errors.length, warnings: warnings.length });
  return errors.length > 0 ? null : loom;
}

export const relPath = (p: string): string => path.relative(process.cwd(), p) || p;

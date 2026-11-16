import * as fs from "node:fs";
import * as path from "node:path";
import type { Command } from "commander";
import ignore from "ignore";
import { generate as generateModel } from "../../api/index.js";
import { hatchViews } from "../../api/render.js";
import { LOOM_VERSION } from "../../api/report.js";
import {
  DEFAULT_SOURCE_LOCALE,
  type EnrichedLoomModel,
  sourceLocaleOf,
} from "../../ir/types/loom-ir.js";
import { validateLoomModel } from "../../ir/validate/validate.js";
import { verifyLoomModel } from "../../ir/verify/verify-ir.js";
import { type GiveUpReport, partitionGiveUps } from "../../system/give-up-report.js";
import { generateSystemsFromLoom } from "../../system/index.js";
import { refusalText } from "../../system/migration-diff.js";
import type { MigrationWarning } from "../../system/migrations-builder.js";
import type { HatchFile } from "../../util/hatch.js";
import { checkGenerated, GeneratedLineError, mergeGenerated } from "../generated-line.js";
import { loadSourceOverrides, loadTranslations } from "../i18n/index.js";
import { readMigrationChain } from "../migrate.js";
import { escapesOutDir } from "../output-containment.js";
import {
  hostValidateOptions,
  type ProjectParseResult,
  parseProject,
  readSource,
  withJsonStdout,
} from "../project.js";
import {
  ALL_WARNINGS_FLAG,
  ALL_WARNINGS_HELP,
  type PhaseTally,
  printAstDiagnostics,
  printIrDiagnostics,
  printSummary,
} from "../report.js";
import { isMigrationRefusal } from "./migrate.js";

/**
 * `ddd generate system --json` — the GenerateReport contract (§4).  Thin
 * wrapper over the toolkit `generate()`: validates and reports the deployable
 * manifest as JSON.  It does not write a project tree — run `generate system
 * -o <dir>` (without `--json`) to emit files.
 */
async function runGenerateJson(file: string): Promise<void> {
  const { absolute, source } = readSource(file);
  const report = await withJsonStdout(() =>
    generateModel(source, { path: absolute, ...hostValidateOptions(absolute) }),
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exit(1);
}

/**
 * Loads the project's `.loomignore` (gitignore-syntax) from the output
 * directory, if present, and returns a matcher.  Patterns are matched
 * against forward-slash-normalised paths relative to the output dir.
 */
function loadLoomIgnore(outDir: string): ignore.Ignore {
  const ig = ignore();
  const file = path.join(outDir, ".loomignore");
  if (fs.existsSync(file)) {
    ig.add(fs.readFileSync(file, "utf8"));
  }
  return ig;
}

interface RunOptions {
  dryRun?: boolean;
  /** `--prune` — delete the files under the generated folders that this run
   *  did not produce (the ones the summary counts).  Off by default: without
   *  a record of earlier runs, a file the model stopped producing and a file
   *  the team added look the same. */
  prune?: boolean;
  /** `--merge` — commit the rendered output on the generated line and merge
   *  it into the current branch (`src/cli/generated-line.ts`). */
  merge?: boolean;
  /** `--check` — exit non-zero when the model at HEAD renders a different
   *  tree than the branch's last generated commit.  Writes nothing. */
  check?: boolean;
  /** `--all-warnings` — print every phase-⑦ warning instead of collapsing a
   *  repeated code to its first occurrence plus a summary line. */
  allWarnings?: boolean;
  /** When true, errors are reported but `runGenerate` returns instead
   * of calling `process.exit`.  Used by watch mode so a typo in the
   * `.ddd` source doesn't tear down the watcher. */
  continueOnError?: boolean;
  /** Compile-time `--trace` switch — when true, the TS generators inject
   * trace-level domain instrumentation (`value_computed`,
   * `precondition_evaluated`, etc., via `requestLog().trace(...)`).  Off
   * by default keeps the artefact lean and the domain layer pure; on
   * regenerate to diagnose.  See https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/proposals/observability.md. */
  emitTrace?: boolean;
  /** `--k8s` switch — when true, `generate system` additionally emits a Helm
   * chart (`helm/`) and the raw manifests it renders to (`k8s/`) alongside
   * `docker-compose.yml`.  See docs/kubernetes.md. */
  emitKubernetes?: boolean;
  /** `--verify-ir` switch — run the IR verifier over the enriched model before
   * phase ⑦ and fail the run on a violation.  A violation is a compiler bug
   * (lowering/enrichment produced an IR the backends cannot consume), not a
   * model error; off by default.  `generate system` only. */
  verifyIr?: boolean;
  /** `--sourcemap` switch — when true, `generate system` additionally emits
   * `debug/sourcemap.json` mapping generated file regions back to `.ddd`
   * spans / macro-call sites.  Off by default (byte-identical output).
   * See https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/plans/source-map-debug-kickoff.md. */
  sourcemap?: boolean;
  /** `--inline-sources` switch — inline each `.ddd`'s full text into every
   * Source Map v3 sidecar.  Off by default: the sidecars name the `.ddd` by
   * ABSOLUTE path and a debugger reads it from there, so inlining it once per
   * generated file (763 KB across 112 sidecars on the ERP example) buys
   * nothing on a local tree.  Turn it on to make the emitted tree
   * self-contained.  Only meaningful with `--sourcemap`. */
  inlineSources?: boolean;
  /** `--locales <dir>` — the `ddd i18n` translator tree root, resolved by the
   * SAME `localesDir` every `ddd i18n` subcommand uses (an explicit dir wins;
   * otherwise `locales/` NEXT TO THE `.ddd`, not next to the cwd).  Every
   * translated locale under it is emitted into each frontend that has a
   * translation runtime and registered in its generated i18n shim — without
   * this the translator's `de.json` never reaches the app.  System target
   * only; no tree on disk is the normal case and changes nothing. */
  localesDir?: string;
}

export interface RunResult {
  /** True iff the run produced an error (parse, IR validation, or
   * thrown during generation).  In one-shot mode the CLI translates
   * this to a non-zero exit; in watch mode it keeps watching. */
  hadError: boolean;
  /** File counts for the "Wrote N…" summary.  Undefined when the run
   * errored out before reaching the write loop. */
  written?: number;
  unchanged?: number;
  skippedByIgnore?: number;
  /** Files deleted by `--prune`. */
  removed?: number;
  /** Files under the generated folders this run did not produce and left in
   *  place (0 under `--prune`). */
  unproduced?: number;
}

/** `generate system` emitted nothing: the source declares no deployable.  The
 *  hint shows the lines to add — platform and database are the author's
 *  choice, so there is no implicit default deployable to fall back on. */
function noDeployableMessage(file: string, loom: EnrichedLoomModel): string {
  const ctx =
    loom.contexts[0]?.name ??
    loom.systems[0]?.subdomains.flatMap((s) => s.contexts)[0]?.name ??
    "Sales";
  const lc = ctx.charAt(0).toLowerCase() + ctx.slice(1);
  return [
    `No deployable declared in ${file}, so there is nothing to generate.  Add a`,
    "system that hosts the contexts on a backend, for example:",
    "",
    `  system ${ctx}System {`,
    "    storage db { type: postgres }",
    `    resource ${lc}State { for: ${ctx}, kind: state, use: db }`,
    `    deployable ${lc} { platform: node, contexts: [${ctx}], dataSources: [${lc}State] }`,
    "  }",
    "",
    "(`platform:` takes node | dotnet | elixir | python | java.)",
  ].join("\n");
}

/** Print phase-⑨ advisories: warnings counted under their own footer,
 *  suggestions (a spent `migration` block) labelled and left out of it. */
export function printMigrationWarnings(migrationWarnings: readonly MigrationWarning[]): void {
  const suggestions = migrationWarnings.filter((w) => w.severity === "suggestion");
  const warnings = migrationWarnings.filter((w) => w.severity !== "suggestion");
  for (const w of warnings) console.error(`${w.code} warning: ${w.message}`);
  for (const w of suggestions) console.error(`${w.code} suggestion: ${w.message}`);
  if (warnings.length > 0) {
    console.error(`${warnings.length} warning(s) in derived migrations.`);
  }
}

/** What one run renders from the model: generated files and hatch stubs, as
 *  two disjoint maps.  Undefined when the model did not generate (the reason
 *  is already printed). */
interface Rendered {
  files: Map<string, string>;
  hatches: Map<string, HatchFile>;
  loom: EnrichedLoomModel;
  /** The model's own files: every `.ddd` the entry imports, plus the
   *  `migrations/` and `locales/` directories beside the entry. */
  sources: string[];
}

/** Parse, validate and render the model in memory, printing every diagnostic.
 *  Shared by `generate system` and `scaffold`, so both see the same files and
 *  the same hatch paths. */
async function renderModel(file: string, options: RunOptions): Promise<Rendered | undefined> {
  // Multi-file aware: load the entry's import graph, lower per document, merge.
  let projectResult: ProjectParseResult;
  try {
    projectResult = await parseProject(file);
  } catch (err) {
    console.error(`${file}: ${err instanceof Error ? err.message : String(err)}`);
    if (!options.continueOnError) process.exit(1);
    return undefined;
  }
  // ALWAYS, not just on the failing runs: a successful `generate system` must
  // print the same phase-④ warnings `ddd parse` prints for the same file.
  const ast: PhaseTally = printAstDiagnostics(projectResult);
  if (projectResult.errorCount > 0) {
    // Phase ⑦ never runs after an AST error, so this is the last phase there
    // is — print the one summary here rather than leaving the run footerless.
    printSummary(ast);
    if (!options.continueOnError) process.exit(1);
    return undefined;
  }
  const loom: EnrichedLoomModel = projectResult.loom;
  const sourceTexts: Map<string, string> = projectResult.sourceTexts;

  // Loom-IR-level validation: catches `api.<unknown>.<verb>` and
  // `ui.<unknown>.<verb>` references in `test e2e` bodies before
  // generators are called, rather than throwing mid-generation with a less
  // helpful trace.
  //
  // Printed by the SAME function `parse` uses, so the two commands report an
  // identical diagnostic set for identical input.  `generate` used to have its
  // own copy that lumped the 12 advisory `loom.index-suggestion` hints in with
  // the real warnings under one count — `parse` reports those separately, and
  // never as warnings — so the two commands' footers didn't even add up to the
  // same number for the same file.
  if (options.verifyIr) {
    const violations = verifyLoomModel(loom);
    if (violations.length > 0) {
      console.error(
        `${file}: IR verification failed — ${violations.length} violation(s). These are compiler invariants, not model errors; please report them.`,
      );
      for (const v of violations) console.error(`  error: ${v}`);
      if (!options.continueOnError) process.exit(1);
      return undefined;
    }
  }
  const loomDiags = validateLoomModel(loom, hostValidateOptions(file));
  const { errors: loomErrors, warnings: loomWarnings } = printIrDiagnostics(loomDiags, sourceTexts);
  // ONE footer, after both phases — the same call `parse` makes at the same
  // point, which is what keeps the two commands' stderr byte-identical
  // (`generate-diagnostic-parity.test.ts`).
  printSummary(ast, { errors: loomErrors.length, warnings: loomWarnings.length });
  if (loomErrors.length > 0) {
    if (!options.continueOnError) process.exit(1);
    return undefined;
  }
  // Directory creation is deferred to the write loop below (and guarded by
  // `!options.dryRun`) so a `--dry-run` touches nothing on disk — not even
  // `mkdir`-ing the output dir.

  let files: Map<string, string>;
  /** Escape-hatch files (`src/util/hatch.ts`): never written by generate. */
  let hatches: Map<string, HatchFile>;
  /** Frontend constructs the walkers declined to render.  The walkers name a
   *  `loom.*` code beside each one in the emitted source; nothing lifted them
   *  until now, so a page whose body is `undefined.data.items.map(…)` shipped
   *  under `0 error(s), 0 warning(s)` (F-019). */
  let giveUps: GiveUpReport[] = [];
  /** Non-fatal diagnostics from the migration derivation (phase ⑨).  Printed
   *  beside the give-ups below — same shape of problem: a fact known inside a
   *  pure pass with no console, which used to reach nobody. */
  let migrationWarnings: MigrationWarning[] = [];
  // Every backend's migration files are rendered from the committed chain
  // beside the source (`migrations/`), so `-o` holds no migration state of
  // its own.  No chain yet ⇒ each module's initial migration, derived from
  // the model.  See docs/migrations.md.
  try {
    const sourceLocale = loom.systems[0] ? sourceLocaleOf(loom.systems[0]) : DEFAULT_SOURCE_LOCALE;
    const emission = generateSystemsFromLoom(loom, {
      emitTrace: options.emitTrace,
      emitKubernetes: options.emitKubernetes,
      migrationChain: readMigrationChain(file),
      sourcemap: options.sourcemap,
      inlineSources: options.inlineSources,
      // Locale catalogs from the translator tree (`ddd i18n init/sync`).
      // Read HERE, not in `src/system/`, which stays fs-free — the same
      // split `sourceTexts` uses.  Empty map ⇒ nothing changes.
      translations: loadTranslations(file, { dir: options.localesDir, source: sourceLocale }),
      // The source language's own `locales/<source>/` directory: overrides of
      // the text the model derives, applied to every emitted default.
      sourceOverrides: loadSourceOverrides(file, {
        dir: options.localesDir,
        source: sourceLocale,
      }),
      // Harmless to pass unconditionally — v3 sidecar emission is still
      // gated on `sourcemap` inside `generateSystemsFromLoom`.
      sourceTexts,
    });
    files = emission.files;
    hatches = emission.hatches;
    giveUps = emission.giveUps;
    // Phase-⑨ advisories (F-3).  The only one today announces the drop+add →
    // RENAME inference the migration builder makes deliberately: it fired,
    // and before this the run said `0 error(s), 0 warning(s)` about it, so
    // an author whose two columns were unrelated was never told their old
    // column's data was about to land under the new name.  A WARNING — the
    // inference is load-bearing, so it must not fail the run, and the
    // migration IS written.
    migrationWarnings = emission.migrationWarnings;
  } catch (err) {
    // An unreadable chain, an unrecorded model change, or a migration the
    // derivation refuses is a recoverable operator problem, not a compiler
    // crash — report it as a clean CLI failure (with the recovery hint from
    // the error message).  Re-throw anything else for the top-level handler.
    if (isMigrationRefusal(err)) {
      console.error(`${file}: ${refusalText(err)}`);
      if (!options.continueOnError) process.exit(1);
      return undefined;
    }
    throw err;
  }
  if (files.size === 0) {
    console.error(noDeployableMessage(file, loom));
    if (!options.continueOnError) process.exit(1);
    return undefined;
  }
  // Its own footer, for the same reason the give-ups have one: the
  // `N error(s), N warning(s).` line above is the phase-④/⑦ verdict and was
  // already printed before generation ran.
  printMigrationWarnings(migrationWarnings);
  // Lift the walkers' give-ups.  They were already in the output, named by
  // code, three characters from the defect — this is the only place with both
  // the emitted text and a console to report against.
  const gu = partitionGiveUps(giveUps);
  for (const g of gu.errors) {
    console.error(`${g.code} ${g.path}:${g.line}: ${g.text}`);
  }
  for (const g of gu.warnings) {
    console.error(`${g.code} ${g.path}:${g.line} warning: ${g.text}`);
  }
  if (gu.errors.length > 0 || gu.warnings.length > 0) {
    console.error(
      `${gu.errors.length} error(s), ${gu.warnings.length} warning(s) in generated pages.`,
    );
  }
  if (gu.errors.length > 0) {
    if (!options.continueOnError) process.exit(1);
    return undefined;
  }
  const dir = path.dirname(path.resolve(file));
  const sources = [
    ...[...sourceTexts.keys()].filter((p) => fs.existsSync(p)),
    path.join(dir, "migrations"),
    options.localesDir ? path.resolve(options.localesDir) : path.join(dir, "locales"),
  ];
  return { files, hatches, loom, sources };
}

/** Directories inside an output folder that belong to a build tool, not to
 *  generation: never walked for the unproduced-files summary, never pruned.
 *  Dot-entries (`.env`, `.git`, `.venv`, …) are skipped the same way. */
const TOOL_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  "bin",
  "obj",
  "_build",
  "deps",
  "__pycache__",
]);

/** Files under the output's generated folders that this run did not produce.
 *  Only the top-level folders the run writes into are walked, so a project
 *  generated into its own root (`-o .`) never lists the model, `migrations/`
 *  or the team's own files beside them. */
function unproducedFiles(
  outDir: string,
  produced: ReadonlySet<string>,
  ig: ignore.Ignore,
): { path: string; bytes: number }[] {
  const roots = new Set<string>();
  for (const p of produced) {
    const slash = p.indexOf("/");
    if (slash > 0) roots.add(p.slice(0, slash));
  }
  const found: { path: string; bytes: number }[] = [];
  const walk = (rel: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(outDir, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (TOOL_DIRS.has(e.name)) continue;
        walk(child);
      } else if (e.isFile()) {
        if (produced.has(child) || ig.ignores(child)) continue;
        found.push({ path: child, bytes: fs.statSync(path.join(outDir, child)).size });
      }
    }
  };
  for (const root of [...roots].sort()) walk(root);
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

/** The hatch files the model calls for that do not exist on disk. */
function missingHatches(
  outDir: string,
  hatches: ReadonlyMap<string, HatchFile>,
  ig: ignore.Ignore,
): string[] {
  return [...hatches.keys()]
    .filter((p) => !ig.ignores(p) && !fs.existsSync(path.join(outDir, p)))
    .sort();
}

/** Refuse when a path would escape the output directory — a generator (in
 *  particular an out-of-tree backend or design pack) must not write
 *  anywhere else on disk. */
function firstEscape(outDir: string, paths: Iterable<string>): string | undefined {
  const resolvedOut = path.resolve(outDir);
  for (const p of paths) if (escapesOutDir(resolvedOut, p)) return p;
  return undefined;
}

async function runGenerate(
  file: string,
  outDir: string,
  options: RunOptions = {},
): Promise<RunResult> {
  const fail = (): RunResult => {
    if (!options.continueOnError) process.exit(1);
    return { hadError: true };
  };
  if (options.merge || options.check) {
    if (options.merge && options.check) {
      console.error("--merge and --check are separate steps; pass one.");
      return fail();
    }
    if (options.dryRun || options.prune) {
      console.error(
        "--merge and --check write through git; they take neither --dry-run nor --prune.",
      );
      return fail();
    }
  }
  const rendered = await renderModel(file, options);
  if (!rendered) return fail();
  if (options.merge || options.check)
    return runGeneratedLine(file, outDir, rendered, options, fail);
  const { files, hatches } = rendered;
  const escaped = firstEscape(outDir, [...files.keys(), ...hatches.keys()]);
  if (escaped !== undefined) {
    console.error(`Refusing to write '${escaped}': path escapes the output directory ${outDir}.`);
    return fail();
  }
  const ig = loadLoomIgnore(outDir);

  // A hatch file the model calls for is the user's code; generation never
  // writes it.  While one is missing the generated code that calls it cannot
  // build, so the run refuses and names the command that writes it.
  const missing = missingHatches(outDir, hatches, ig);
  if (missing.length > 0) {
    console.error(
      `${file}: ${missing.length} escape-hatch file(s) the model calls for do not exist yet:`,
    );
    for (const p of missing) console.error(`  ${p}`);
    console.error(
      `Run \`ddd scaffold ${file} -o ${outDir}\` to write them (only missing files are written), then generate again.`,
    );
    return fail();
  }

  let written = 0;
  let unchanged = 0;
  let skippedByIgnore = 0;
  for (const relPath of [...files.keys()].sort()) {
    const content = files.get(relPath)!;
    const full = path.join(outDir, relPath);
    const ignored = ig.ignores(relPath);
    // An up-to-date file is not rewritten, so mtimes stay a precise reload
    // signal for watchers (Vite, `dotnet watch`); a dry run classifies the
    // same way so its tallies match the run it previews.
    const wouldChange = !ignored && !fileContentMatches(full, content);
    if (ignored) skippedByIgnore++;
    else if (wouldChange) written++;
    else unchanged++;
    if (options.dryRun) {
      const sizeKb = (Buffer.byteLength(content, "utf8") / 1024).toFixed(1);
      const status = ignored
        ? "  skip (.loomignore)"
        : wouldChange
          ? "  write             "
          : "  unchanged         ";
      console.log(`${status}  ${relPath}  (${sizeKb} KB)`);
      continue;
    }
    if (!wouldChange) continue;
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
  }

  // Files this run did not produce are left alone: nothing records what an
  // earlier run wrote, so the generator cannot tell a stale file from one the
  // team added.  They are counted, and `--prune` deletes them on request.
  const produced = new Set([...files.keys(), ...hatches.keys()]);
  const unproduced = unproducedFiles(outDir, produced, ig);
  let removed = 0;
  if (options.prune) {
    const resolvedOut = path.resolve(outDir);
    for (const { path: relPath } of unproduced) {
      if (options.dryRun) {
        console.log(`  remove             ${relPath}`);
        removed++;
        continue;
      }
      const full = path.join(outDir, relPath);
      try {
        fs.rmSync(full);
      } catch (err) {
        console.error(`Could not remove '${relPath}': ${(err as Error).message}`);
        continue;
      }
      console.log(`  removed            ${relPath}`);
      removed++;
      pruneEmptyDirs(resolvedOut, path.dirname(full));
    }
  }

  const verb = options.dryRun ? "Would write" : "Wrote";
  const parts: string[] = [`${verb} ${written} file(s) in ${outDir}`];
  if (unchanged > 0) parts.push(`unchanged: ${unchanged}`);
  if (hatches.size > 0) parts.push(`hatch files (yours): ${hatches.size}`);
  if (skippedByIgnore > 0) parts.push(`skipped (.loomignore): ${skippedByIgnore}`);
  if (removed > 0) parts.push(`${options.dryRun ? "would remove" : "removed"}: ${removed}`);
  console.log(parts.join(", "));
  if (unproduced.length > 0 && !options.prune) {
    const kb = (unproduced.reduce((n, f) => n + f.bytes, 0) / 1024).toFixed(1);
    console.log(
      `${unproduced.length} file(s) not produced by the model (${kb} KB), left untouched; \`--prune\` deletes them.`,
    );
  }
  return {
    hadError: false,
    written,
    unchanged,
    skippedByIgnore,
    removed,
    unproduced: options.prune ? 0 : unproduced.length,
  };
}

/** `--merge` / `--check`: the generated line (`src/cli/generated-line.ts`).
 *  The rendered tree is every generated file plus every hatch stub: the
 *  generated commit is the pristine output, so the merge brings a new hook's
 *  stub into the user's hatch file and turns a renamed or re-signed hook into
 *  a conflict there. */
function runGeneratedLine(
  file: string,
  outDir: string,
  rendered: Rendered,
  options: RunOptions,
  fail: () => RunResult,
): RunResult {
  const tree = new Map(rendered.files);
  for (const [p, h] of rendered.hatches) tree.set(p, h.stub);
  const again = `ddd generate system ${file} -o ${outDir} --merge`;
  try {
    if (options.check) {
      const r = checkGenerated(outDir, tree);
      if (r.upToDate) {
        console.log(`${outDir}: up to date with the model at HEAD.`);
        return { hadError: false };
      }
      console.error(`${outDir}: out of date — ${r.reason}.`);
      console.error(`Run \`${again}\`, resolve any conflicts, and commit.`);
      return fail();
    }
    const r = mergeGenerated(outDir, tree, {
      sources: rendered.sources,
      hatchPaths: [...rendered.hatches.keys()],
      ignore: loadLoomIgnore(outDir),
      version: LOOM_VERSION,
    });
    const which = r.created ? "new generated commit" : "generated commit unchanged";
    if (r.alreadyMerged) {
      console.log(`${which} ${r.generated.slice(0, 12)}; already merged — nothing to do.`);
      return { hadError: false };
    }
    if (r.conflicts.length === 0) {
      console.log(`${which} ${r.generated.slice(0, 12)}; merged into the branch.`);
      return { hadError: false };
    }
    console.error(
      `${which} ${r.generated.slice(0, 12)}; the merge stopped on ${r.conflicts.length} conflict(s):`,
    );
    for (const c of r.conflicts) console.error(`  ${c}`);
    console.error(
      "Resolve them and `git commit`, or `git merge --abort`.  For a hatch file, `ddd render <file.ddd> <path>` prints its fresh stub: take the signature from the stub and keep your body.",
    );
    return fail();
  } catch (err) {
    if (!(err instanceof GeneratedLineError)) throw err;
    console.error(`${file}: ${err.message}`);
    return fail();
  }
}

/** `ddd scaffold` — write every escape-hatch file the model calls for that is
 *  missing.  An existing file is never touched: it is the user's code. */
async function runScaffold(file: string, outDir: string, options: RunOptions = {}): Promise<void> {
  const rendered = await renderModel(file, options);
  if (!rendered) process.exit(1);
  const { hatches } = rendered;
  const escaped = firstEscape(outDir, hatches.keys());
  if (escaped !== undefined) {
    console.error(`Refusing to write '${escaped}': path escapes the output directory ${outDir}.`);
    process.exit(1);
  }
  const ig = loadLoomIgnore(outDir);
  const missing = missingHatches(outDir, hatches, ig);
  for (const relPath of missing) {
    if (options.dryRun) {
      console.log(`  would write        ${relPath}`);
      continue;
    }
    const full = path.join(outDir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, hatches.get(relPath)!.stub, { encoding: "utf8", flag: "wx" });
    console.log(`  wrote              ${relPath}`);
  }
  const present = hatches.size - missing.length;
  console.log(
    `${options.dryRun ? "Would write" : "Wrote"} ${missing.length} hatch file(s) in ${outDir}, already present: ${present}`,
  );
}

/** After deleting a file, walk its parent chain up to (but never including)
 *  the output dir and drop directories the deletion emptied.  `rmdirSync`
 *  fails on a non-empty directory, which is exactly the stop condition. */
function pruneEmptyDirs(resolvedOut: string, startDir: string): void {
  let dir = path.resolve(startDir);
  while (dir.startsWith(resolvedOut + path.sep)) {
    try {
      fs.rmdirSync(dir);
    } catch {
      return; // non-empty (or gone) — stop climbing
    }
    dir = path.dirname(dir);
  }
}

/** True iff the file at `absPath` exists and its bytes match `content`
 *  exactly.  Used to skip writes that would produce identical output. */
function fileContentMatches(absPath: string, content: string): boolean {
  if (!fs.existsSync(absPath)) return false;
  try {
    const existing = fs.readFileSync(absPath, "utf8");
    return existing === content;
  } catch {
    return false;
  }
}

async function watchAndRegenerate(
  file: string,
  outDir: string,
  extraOptions: Partial<RunOptions> = {},
) {
  console.log(`Watching ${file} for changes…`);
  let timer: NodeJS.Timeout | null = null;
  let inFlight = false;
  let pending = false;
  const regen = async () => {
    if (inFlight) {
      // Coalesce: a save while a regen is running schedules at most
      // one follow-up.  Avoids unbounded queueing if the user
      // mashes Cmd+S during a slow regen.
      pending = true;
      return;
    }
    inFlight = true;
    try {
      await runGenerate(file, outDir, { continueOnError: true, ...extraOptions });
    } catch (err) {
      // Defensive — runGenerate is supposed to capture its own
      // errors when continueOnError is set, but a renderer throwing
      // shouldn't kill the watch loop.
      console.error(err);
    } finally {
      inFlight = false;
      if (pending) {
        pending = false;
        await regen();
      }
    }
  };
  fs.watch(file, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(regen, 100);
  });
  // Keep the process alive
  await new Promise(() => {});
}

/** Registers `ddd generate` on the CLI program. */
export function registerGenerateCommand(program: Command): void {
  const generate = program.command("generate").description("Generate code from a .ddd file");

  generate
    .command("system <file>")
    .description(
      "Generate every deployable in the file's `system` blocks plus a docker-compose.yml at the output root.",
    )
    .option("-o, --out <dir>", "output directory (required unless --json)")
    .option("-w, --watch", "re-run on changes to <file>")
    .option("--dry-run", "list paths that would be written / skipped, write nothing")
    .option(
      "--merge",
      "commit the rendered output as a generated commit (trailer `Generated-from:`) on top of the generated commits this branch already contains, then `git merge` it — your edits to generated files and hatch files merge like any branch. Needs a git work tree and a committed model.",
    )
    .option(
      "--check",
      "exit 1 when the model at HEAD renders a different output than the branch's last generated commit (for CI); writes nothing",
    )
    .option(
      "--prune",
      "delete the files under the generated folders that this run did not produce (generate otherwise leaves them and prints a count)",
    )
    .option(
      "--json",
      "validate and print the deployable manifest as JSON (GenerateReport); writes no files. See docs/api-toolkit.md.",
    )
    .option(
      "--trace",
      "emit trace-level domain instrumentation (value_computed, precondition_evaluated, …) — off by default; see docs/observability.md",
    )
    .option(
      "--k8s",
      "also emit a Helm chart (helm/) and raw manifests (k8s/) alongside docker-compose.yml; see docs/kubernetes.md",
    )
    .option(
      "--verify-ir",
      "run the IR verifier (compiler self-check of lowering/enrichment output) before validation and exit non-zero on a violation; off by default. See docs/tools.md.",
    )
    .option(
      "--sourcemap",
      "emit debug/sourcemap.json mapping generated code back to .ddd spans; off by default. See docs/debugging.md.",
    )
    .option(
      "--inline-sources",
      "with --sourcemap, inline each .ddd's full text into every Source Map v3 sidecar. Off by default — the sidecars name the .ddd by absolute path and a debugger reads it from there, so inlining it once per generated file costs ~4x the map bytes for nothing. Turn it on when the maps will be read where the .ddd files are not.",
    )
    .option(ALL_WARNINGS_FLAG, ALL_WARNINGS_HELP)
    .option(
      "--locales <dir>",
      "translator tree root to read locale catalogs from (default: <.ddd file's dir>/locales — the same resolution as `ddd i18n --dir`). Each locale found is emitted into every frontend with a translation runtime and registered in its i18n shim.",
    )
    .action(
      async (
        file: string,
        options: {
          out?: string;
          watch?: boolean;
          dryRun?: boolean;
          prune?: boolean;
          merge?: boolean;
          check?: boolean;
          json?: boolean;
          trace?: boolean;
          k8s?: boolean;
          verifyIr?: boolean;
          sourcemap?: boolean;
          inlineSources?: boolean;
          locales?: string;
          allWarnings?: boolean;
        },
      ) => {
        if (options.json) {
          await runGenerateJson(file);
          return;
        }
        if (!options.out) {
          console.error("error: required option '-o, --out <dir>' not specified");
          process.exit(1);
        }
        const runOpts = {
          dryRun: options.dryRun,
          prune: options.prune,
          merge: options.merge,
          check: options.check,
          emitTrace: !!options.trace,
          emitKubernetes: !!options.k8s,
          verifyIr: !!options.verifyIr,
          sourcemap: !!options.sourcemap,
          inlineSources: !!options.inlineSources,
          localesDir: options.locales,
          allWarnings: options.allWarnings,
        };
        await runGenerate(file, options.out, runOpts);
        if (options.watch) {
          await watchAndRegenerate(file, options.out, runOpts);
        }
      },
    );
}

/** Registers `ddd scaffold` on the CLI program. */
export function registerScaffoldCommand(program: Command): void {
  program
    .command("scaffold <file>")
    .description(
      "Write the escape-hatch files (extern implementations) the model calls for that do not exist yet. Existing files are never touched.",
    )
    .requiredOption("-o, --out <dir>", "output directory (the one `generate system -o` writes)")
    .option("--dry-run", "list the hatch files that would be written, write nothing")
    .option(
      "--locales <dir>",
      "translator tree root (default: <.ddd file's dir>/locales), as for `generate system`",
    )
    .action(async (file: string, options: { out: string; dryRun?: boolean; locales?: string }) => {
      await runScaffold(file, options.out, { dryRun: options.dryRun, localesDir: options.locales });
    });
}

/** Registers `ddd render` on the CLI program. */
export function registerRenderCommand(program: Command): void {
  program
    .command("render <file> [path]")
    .description(
      "Print one output path as `generate system` would render it — a generated file or the fresh stub of a hatch file — without writing anything. With --hatches, list every hatch file the model calls for with its expected signatures.",
    )
    .option(
      "--hatches",
      "list the hatch (extern implementation) files instead of rendering one path",
    )
    .option(
      "-o, --out <dir>",
      "with --hatches: the output directory, to report each file present or pending",
    )
    .option("--json", "print the result as JSON")
    .option(
      "--locales <dir>",
      "translator tree root (default: <.ddd file's dir>/locales), as for `generate system`",
    )
    .action(
      async (
        file: string,
        relPath: string | undefined,
        options: { hatches?: boolean; out?: string; json?: boolean; locales?: string },
      ) => {
        const rendered = await renderModel(file, { localesDir: options.locales });
        if (!rendered) process.exit(1);
        if (options.hatches) {
          const existing = options.out
            ? [...rendered.hatches.keys()].filter((p) => fs.existsSync(path.join(options.out!, p)))
            : undefined;
          const rows = hatchViews(rendered.hatches, rendered.loom, existing).map(
            ({ stub: _stub, ...row }) => row,
          );
          if (options.json) {
            process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
            return;
          }
          for (const r of rows) {
            console.log(`${r.state ? `${r.state.padEnd(8)} ` : ""}${r.owner}  ${r.path}`);
            for (const sig of r.signatures) console.log(`    ${sig}`);
          }
          return;
        }
        if (!relPath) {
          console.error("error: give an output path to render, or --hatches");
          process.exit(1);
        }
        const generated = rendered.files.get(relPath);
        const hatch = rendered.hatches.get(relPath);
        const role = generated !== undefined ? "generated" : hatch ? "hatch-stub" : "absent";
        const content = generated ?? hatch?.stub;
        if (options.json) {
          const report = { path: relPath, role, ...(hatch ? { owner: hatch.owner } : {}), content };
          process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
          if (role === "absent") process.exit(1);
          return;
        }
        if (content === undefined) {
          console.error(`${file}: the model produces no file at ${relPath}`);
          process.exit(1);
        }
        process.stdout.write(content);
      },
    );
}

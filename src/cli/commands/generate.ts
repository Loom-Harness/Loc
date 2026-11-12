import * as fs from "node:fs";
import * as path from "node:path";
import type { Command } from "commander";
import ignore from "ignore";
import { generate as generateModel } from "../../api/index.js";
import {
  DEFAULT_SOURCE_LOCALE,
  type EnrichedLoomModel,
  sourceLocaleOf,
} from "../../ir/types/loom-ir.js";
import { validateLoomModel } from "../../ir/validate/validate.js";
import { verifyLoomModel } from "../../ir/verify/verify-ir.js";
import { type GiveUpReport, partitionGiveUps } from "../../system/give-up-report.js";
import { generateSystemsFromLoom } from "../../system/index.js";
import {
  buildManifest,
  carriedOverEntries,
  contentDigest,
  MANIFEST_REL_PATH,
  type ManifestEntry,
  type OutputManifest,
  parseManifest,
  planPrune,
  serializeManifest,
} from "../../system/manifest.js";
import type { MigrationWarning } from "../../system/migrations-builder.js";
import { isScaffoldOnce } from "../../util/scaffold-once.js";
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
   * `.loom/sourcemap.json` mapping generated file regions back to `.ddd`
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
  /** Files preserved on regen because they are scaffold-once and already
   * existed on disk (user-owned extern impls, etc.). */
  preservedScaffold?: number;
  /** Stale files deleted on regen: listed in the previous `.loom/manifest.json`
   * but no longer emitted.  See `src/system/manifest.ts`. */
  removed?: number;
  /** Of `written`, how many landed on a file whose content no longer matched
   * the digest the previous manifest recorded — i.e. Loom overwrote somebody's
   * local edit (finding F-019).  Always ≤ `written`. */
  locallyModified?: number;
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

async function runGenerate(
  file: string,
  outDir: string,
  options: RunOptions = {},
): Promise<RunResult> {
  // Multi-file aware: load the entry's import graph, lower per document, merge.
  let projectResult: ProjectParseResult;
  try {
    projectResult = await parseProject(file);
  } catch (err) {
    console.error(`${file}: ${err instanceof Error ? err.message : String(err)}`);
    if (!options.continueOnError) process.exit(1);
    return { hadError: true };
  }
  // ALWAYS, not just on the failing runs: a successful `generate system` must
  // print the same phase-④ warnings `ddd parse` prints for the same file.
  const ast: PhaseTally = printAstDiagnostics(projectResult);
  if (projectResult.errorCount > 0) {
    // Phase ⑦ never runs after an AST error, so this is the last phase there
    // is — print the one summary here rather than leaving the run footerless.
    printSummary(ast);
    if (!options.continueOnError) process.exit(1);
    return { hadError: true };
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
      return { hadError: true };
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
    return { hadError: true };
  }
  // Directory creation is deferred to the write loop below (and guarded by
  // `!options.dryRun`) so a `--dry-run` touches nothing on disk — not even
  // `mkdir`-ing the output dir.

  let files: Map<string, string>;
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
      console.error(`${file}: ${err.message}`);
      if (!options.continueOnError) process.exit(1);
      return { hadError: true };
    }
    throw err;
  }
  if (files.size === 0) {
    console.error(noDeployableMessage(file, loom));
    if (!options.continueOnError) process.exit(1);
    return { hadError: true };
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
    return { hadError: true };
  }

  const ig = loadLoomIgnore(outDir);
  let written = 0;
  let unchanged = 0;
  let skippedByIgnore = 0;
  let preservedScaffold = 0;
  const resolvedOut = path.resolve(outDir);
  // The manifest the LAST run wrote (`.loom/manifest.json`) — the only
  // authority for what this generator owns on disk, and therefore for what it
  // may delete when it stops emitting a path.  Missing/unreadable ⇒ null ⇒
  // this run prunes nothing and simply re-establishes the manifest.
  const previousManifest = readOutputManifest(outDir);
  // path → digest of what the LAST run wrote there (absent for a manifest
  // written before the field existed).
  const previousHashes = new Map<string, string>();
  for (const e of previousManifest?.entries ?? []) {
    if (e.hash) previousHashes.set(e.path, e.hash);
  }
  const locallyModifiedPaths: string[] = [];
  // The manifest the NEXT run diffs against, computed BEFORE the write loop
  // and then handed to that loop as an ordinary emitted file.  Everything the
  // writer already guarantees therefore applies to it for free: `--dry-run`
  // lists it (so the preview still predicts exactly the set a real run
  // writes), and an unchanged manifest is not rewritten (so a no-op regen
  // still touches no mtime — the reload signal watchers depend on).  Both are
  // gated by `test/cli/regeneration.test.ts`, and special-casing the manifest
  // broke both; nothing here may reintroduce a bespoke write path for it.
  //
  // `.loomignore`d paths are excluded from the entries: the run did not write
  // them, so it must not claim ownership of them.  The manifest lists itself,
  // which keeps it out of its own successor's prune set (belt to
  // `isProtectedFromPrune`'s braces).
  const manifestEntries: ManifestEntry[] = [{ path: MANIFEST_REL_PATH }];
  for (const relPath of [...files.keys()].sort()) {
    const normalised = relPath.split(path.sep).join("/");
    if (ig.ignores(normalised)) continue;
    const content = files.get(relPath)!;
    // The digest of the bytes this run puts at the path — the record the NEXT
    // run diffs disk against to tell a model-driven rewrite from one that
    // lands on a file a human edited (finding F-019).
    manifestEntries.push({
      path: normalised,
      ...(isScaffoldOnce(content) ? { scaffoldOnce: true as const } : {}),
      hash: contentDigest(content),
    });
  }
  // Paths a past run emitted and this one does not, but that the generator
  // still owns — the protected families, chiefly the earlier migrations no
  // backend re-emits.  Carried over so the manifest does not churn; see
  // `carriedOverEntries`.
  manifestEntries.push(
    ...carriedOverEntries(
      previousManifest,
      manifestEntries.map((e) => e.path),
      (p) => fs.existsSync(path.join(outDir, p)),
    ),
  );
  files.set(MANIFEST_REL_PATH, serializeManifest(buildManifest(manifestEntries)));

  const sortedPaths = [...files.keys()].sort();
  for (const relPath of sortedPaths) {
    const content = files.get(relPath)!;
    // Output-path containment: every generated key must resolve to a path
    // strictly inside the out dir.  An absolute key or one that climbs out
    // via `..` would let a generator (in particular an untrusted, out-of-
    // tree backend/design pack) write anywhere on disk — reject it loudly
    // rather than honouring the escape.  Checked for dry-run and real runs
    // alike, before any filesystem touch.
    if (escapesOutDir(resolvedOut, relPath)) {
      console.error(`Refusing to write '${relPath}': path escapes the output directory ${outDir}.`);
      if (!options.continueOnError) process.exit(1);
      return { hadError: true };
    }
    const normalised = relPath.split(path.sep).join("/");
    const ignored = ig.ignores(normalised);
    const full = path.join(outDir, relPath);
    // Scaffold-once preservation (`src/util/scaffold-once.ts`): a file the
    // generator marks scaffold-once (an `extern` impl, say) is written on the
    // FIRST generate but never overwritten again, so the user's hand-written
    // implementation survives every regen.  Detected in-band from the generated
    // content's marker; only applies once the file already exists on disk.
    const preserved = !ignored && isScaffoldOnce(content) && fs.existsSync(full);
    // Classify exactly as the real writer does so a dry run's tallies
    // match the run it previews: an up-to-date file is `unchanged`, not
    // a would-write.  `fileContentMatches` returns false for a missing
    // file (fresh output dir ⇒ everything is a write).
    const wouldChange = !ignored && !preserved && !fileContentMatches(full, content);
    // Is the copy on disk still the copy WE last wrote?  Only asked of files
    // this run is about to overwrite (a file whose content already equals what
    // we would write carries no local edit by definition), and only answerable
    // when the previous manifest recorded a digest — an older manifest, or a
    // path a past run never claimed, reads as unknown provenance and says
    // nothing.  The overwrite still happens: this changes the REPORT, not the
    // contract (`docs/tools.md`).
    const locallyModified = wouldChange && hasLocalEdit(previousHashes, normalised, full);
    if (locallyModified) locallyModifiedPaths.push(normalised);
    if (options.dryRun) {
      const sizeKb = (Buffer.byteLength(content, "utf8") / 1024).toFixed(1);
      const status = ignored
        ? "  skip (.loomignore)"
        : preserved
          ? "  keep (scaffold-once)"
          : locallyModified
            ? "  write (local edits) "
            : wouldChange
              ? "  write              "
              : "  unchanged          ";
      console.log(`${status}  ${relPath}  (${sizeKb} KB)`);
      if (ignored) skippedByIgnore++;
      else if (preserved) preservedScaffold++;
      else if (wouldChange) written++;
      else unchanged++;
      continue;
    }
    if (ignored) {
      skippedByIgnore++;
      continue;
    }
    if (preserved) {
      preservedScaffold++;
      continue;
    }
    // Incremental write: only touch files whose content actually
    // changed.  Downstream watchers (Vite, `dotnet watch`) react to
    // mtimes, so skipping unchanged writes turns a regen of an N-file
    // project where the user touched one aggregate into a precise
    // reload signal instead of a full project bounce.
    if (!wouldChange) {
      unchanged++;
      continue;
    }
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
    written++;
  }
  // ── Prune (finding G1) ────────────────────────────────────────────────
  // Regeneration used to only ever ADD: rename an operation and the old
  // handler stayed behind, calling a method the aggregate no longer has, so
  // the generated project stopped compiling.  A path is deleted only when the
  // PREVIOUS manifest lists it (⇒ a past run of this generator wrote it) and
  // this run does not emit it.  `planPrune` additionally spares scaffold-once
  // files, `.loomignore`d paths, and the protected families (migration files,
  // `.loom/snapshots/`) — see `src/system/manifest.ts` for why each is on the
  // list.  Anything with no manifest entry — every hand-written file — is
  // structurally out of reach.
  //
  // Runs AFTER the write loop, so the new manifest is already on disk.  A run
  // killed between the two therefore leaves a stale file that no manifest
  // lists any more — it survives forever instead of being deleted.  That is
  // the direction to fail in: this code's only irreversible act is a delete.
  const prune = planPrune(
    previousManifest,
    manifestEntries.map((e) => e.path),
    {
      isIgnored: (p) => ig.ignores(p),
      exists: (p) => fs.existsSync(path.join(outDir, p)),
    },
  );
  let removed = 0;
  for (const relPath of prune.remove) {
    // A manifest is a file on disk and can be hand-edited; re-apply the same
    // containment check the write loop uses so a doctored entry can never
    // make a regen delete outside the output tree.
    if (escapesOutDir(resolvedOut, relPath)) {
      console.error(
        `Refusing to remove '${relPath}': path escapes the output directory ${outDir}.`,
      );
      continue;
    }
    const full = path.join(outDir, relPath);
    if (options.dryRun) {
      console.log(`  remove (stale)      ${relPath}`);
      removed++;
      continue;
    }
    try {
      fs.rmSync(full);
    } catch (err) {
      console.error(`Could not remove stale file '${relPath}': ${(err as Error).message}`);
      continue;
    }
    console.log(`  removed             ${relPath}`);
    removed++;
    pruneEmptyDirs(resolvedOut, path.dirname(full));
  }

  const verb = options.dryRun ? "Would write" : "Wrote";
  const parts: string[] = [`${verb} ${written} file(s) in ${outDir}`];
  if (locallyModifiedPaths.length > 0) {
    parts.push(
      `${locallyModifiedPaths.length} of which had local modifications (pinnable via .loomignore)`,
    );
  }
  if (unchanged > 0) parts.push(`unchanged: ${unchanged}`);
  if (preservedScaffold > 0) parts.push(`preserved (scaffold-once): ${preservedScaffold}`);
  if (skippedByIgnore > 0) parts.push(`skipped (.loomignore): ${skippedByIgnore}`);
  if (removed > 0) parts.push(`${options.dryRun ? "would remove" : "removed"} (stale): ${removed}`);
  console.log(parts.join(", "));
  // NAME the hand-edited files, not just count them (eval item #40a): the
  // count alone told the reader edits were lost but not WHICH, so the one
  // remedy the summary offers — pin it in `.loomignore` — had no path to pin.
  // Capped, so a bulk edit does not bury the summary; same list under
  // `--dry-run`, where it is the preview of exactly what a real run clobbers.
  if (locallyModifiedPaths.length > 0) {
    const shown = locallyModifiedPaths.slice(0, LOCALLY_MODIFIED_LIST_CAP);
    console.log(
      options.dryRun
        ? `Would overwrite local modifications in (add a path to ${path.join(outDir, ".loomignore")} to keep your version):`
        : `Overwrote local modifications in (add a path to ${path.join(outDir, ".loomignore")} so the next run leaves it alone):`,
    );
    for (const p of shown) console.log(`  ${p}`);
    const rest = locallyModifiedPaths.length - shown.length;
    if (rest > 0) console.log(`  … and ${rest} more`);
  }
  return {
    hadError: false,
    written,
    unchanged,
    skippedByIgnore,
    preservedScaffold,
    removed,
    locallyModified: locallyModifiedPaths.length,
  };
}

/** How many locally-modified paths the regenerate summary names before it
 *  collapses the rest into "… and N more". */
const LOCALLY_MODIFIED_LIST_CAP = 10;

/** Read `.loom/manifest.json` from a previous run.  Any failure — absent,
 *  unreadable, truncated, or a newer schema version — degrades to `null`,
 *  i.e. "prune nothing this run". */
function readOutputManifest(outDir: string): OutputManifest | null {
  const file = path.join(outDir, MANIFEST_REL_PATH);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  return parseManifest(text);
}

/** After deleting a stale file, walk its parent chain up to (but never
 *  including) the output dir and drop directories the deletion emptied — a
 *  renamed page should not leave an empty `pages/` husk behind.  `rmdirSync`
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
 * exactly.  Used to skip writes that would produce identical output. */
/** True when the file at `absPath` differs from the digest the previous
 *  manifest recorded for `relPath` — i.e. somebody edited Loom's output since
 *  the last generate (finding F-019).
 *
 *  Fail-QUIET in every uncertain direction: no recorded digest (a pre-F-019
 *  manifest, or a path this generator never claimed) and an unreadable file
 *  both answer `false`.  A wrong `true` would accuse the user of an edit they
 *  did not make, which is worse than staying silent — the write happens either
 *  way. */
function hasLocalEdit(
  previousHashes: ReadonlyMap<string, string>,
  relPath: string,
  absPath: string,
): boolean {
  const recorded = previousHashes.get(relPath);
  if (!recorded) return false;
  try {
    return contentDigest(fs.readFileSync(absPath, "utf8")) !== recorded;
  } catch {
    return false;
  }
}

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
      "emit .loom/sourcemap.json mapping generated code back to .ddd spans; off by default. See docs/debugging.md.",
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

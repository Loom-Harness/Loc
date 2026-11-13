import * as fs from "node:fs";
import * as path from "node:path";
import type { Command } from "commander";
import type { TestOutcome } from "../../ir/types/loom-ir.js";
import { validateLoomModel } from "../../ir/validate/validate.js";
import { serviceSlug } from "../../system/index.js";
import {
  describeMissingCause,
  type LabelledReport,
  missingEvidence,
  reportWarnings,
} from "../../verify/diagnose.js";
import { fromPlaywrightReport, PlaywrightReportError } from "../../verify/from-playwright.js";
import { fromVitestReport, VitestReportError } from "../../verify/from-vitest.js";
import {
  renderVerdictGraph,
  renderVerificationJson,
  renderVerificationMd,
} from "../../verify/render.js";
import { attributeResults, computeVerification } from "../../verify/verification.js";
import { hostValidateOptions, parseProject } from "../project.js";
import { printAstDiagnostics, printIrDiagnostics, printSummary } from "../report.js";

/** The closed `status` vocabulary of a `--results` document (docs/verify.md). */
const RESULT_STATUSES: ReadonlySet<string> = new Set(["pass", "fail", "skip"]);

/** The runner spellings people reach for, mapped to the one they meant. */
const RESULT_STATUS_HINTS: Readonly<Record<string, string>> = {
  passed: "pass",
  failed: "fail",
  skipped: "skip",
  pending: "skip",
  todo: "skip",
};

/** Shape-check every `--results` entry before it reaches the join.  Without it
 *  a runner spelling (`"failed"`) is neither a pass nor a fail to the rollup, so
 *  a FAILED test left its requirement merely unverified and the gate could exit
 *  0 (eval item #36).  Throws — the caller turns that into exit 2. */
function checkResultEntries(results: readonly unknown[]): TestOutcome[] {
  results.forEach((entry, i) => {
    const e = entry as { name?: unknown; status?: unknown } | null;
    if (e == null || typeof e !== "object") {
      throw new Error(`results[${i}] is not an object`);
    }
    if (typeof e.name !== "string") {
      throw new Error(`results[${i}] has no string "name"`);
    }
    if (typeof e.status !== "string" || !RESULT_STATUSES.has(e.status)) {
      const got = JSON.stringify(e.status);
      const hint =
        typeof e.status === "string" ? RESULT_STATUS_HINTS[e.status.toLowerCase()] : undefined;
      throw new Error(
        `results[${i}] ("${e.name}") has status ${got}; expected "pass", "fail" or "skip"` +
          (hint ? ` — did you mean "${hint}"?` : "") +
          ` (a vitest/jest JSON report can be passed as-is with --from-vitest)`,
      );
    }
  });
  return results as TestOutcome[];
}

interface VerifyOptions {
  /** Every option below is repeatable (commander collects into an array). */
  results: string[];
  fromVitest: string[];
  fromPlaywright: string[];
  out?: string;
  requireAll?: boolean;
  min?: string;
  allowMissing?: boolean;
  json?: boolean;
}

/** Commander collector for a repeatable option. */
function collectRepeated(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/** Structural probe for "this JSON is a vitest/jest report, not a Loom
 *  results document" — used only to word the parse error. */
interface Vitestish {
  testResults?: unknown;
}

/** Structural probe for "this JSON is a Playwright report". */
interface Playwrightish {
  suites?: unknown;
  config?: unknown;
}

/** One runner report to read: which reader, and the file. */
interface ReportInput {
  flag: "--results" | "--from-vitest" | "--from-playwright";
  path: string;
}

/** Read and adapt one report into normalized outcomes.  Throws — the caller
 *  turns that into exit 2, naming the file. */
function readReport(input: ReportInput): TestOutcome[] {
  const raw: unknown = JSON.parse(fs.readFileSync(input.path, "utf8"));
  if (input.flag === "--from-vitest") return fromVitestReport(raw);
  if (input.flag === "--from-playwright") return fromPlaywrightReport(raw);
  const parsed = raw as { results?: TestOutcome[] };
  if (!Array.isArray(parsed?.results)) {
    // The most common wrong input is a runner report fed to `--results`;
    // name the flag that reads it rather than leaving the reader to write an
    // adapter.
    const isObj = raw != null && typeof raw === "object";
    const looksVitest = isObj && Array.isArray((raw as Vitestish).testResults);
    const looksPlaywright =
      isObj &&
      Array.isArray((raw as Playwrightish).suites) &&
      (raw as Playwrightish).config !== undefined;
    throw new Error(
      'expected a top-level "results" array' +
        (looksVitest
          ? ' — this looks like a vitest/jest "--reporter=json" report; pass it with --from-vitest instead'
          : looksPlaywright
            ? ' — this looks like a Playwright "--reporter=json" report; pass it with --from-playwright instead'
            : ""),
    );
  }
  return checkResultEntries(parsed.results);
}

/** `ddd verify` — join test-results reports onto the requirements graph,
 *  emit the verification artifacts, and gate the exit code.
 *
 *  Takes ANY NUMBER of reports, of any mix of kinds: a generated tree runs
 *  its unit and e2e tiers in separate runner projects, each writing its own
 *  report, so a whole-system verdict needs all of them.  They are merged by
 *  concatenation — two runs of one test resolve to the worst of them, the
 *  same rule that settles an api-e2e block replayed against two backends.
 *
 *  Multi-file aware for the same reason `runSnapshot` is: a requirements
 *  graph split across `import "./shared.ddd"` has to be READ the way
 *  `generate system` reads it, or the verb rejects a model that generates
 *  fine. */
async function runVerify(
  file: string,
  inputs: readonly ReportInput[],
  options: VerifyOptions,
): Promise<void> {
  // Validate `--min` up front: `Number("90%")` / `Number("abc")` is NaN and
  // `actual < NaN` is always false, so a typo'd threshold would silently pass
  // the gate.  Reject non-numeric or out-of-[0,100] values before any work.
  let minPct: number | undefined;
  if (options.min !== undefined) {
    minPct = Number(options.min);
    if (!Number.isFinite(minPct) || minPct < 0 || minPct > 100) {
      console.error(
        `Invalid --min "${options.min}": expected a number between 0 and 100 (e.g. --min 90).`,
      );
      process.exit(2);
    }
  }

  const result = await parseProject(file);
  const ast = printAstDiagnostics(result);
  if (result.errorCount > 0) {
    printSummary(ast);
    process.exit(2);
  }
  const loom = result.loom;
  // The same phase-⑦ printer and single footer `parse` uses, so a
  // verification run reports the same warnings, suggestions and counts as the
  // pre-flight for the same file.  A verification run is a Definition-of-Done
  // verdict; a warning is exactly what should reach whoever reads it.
  // Warnings and suggestions never change the exit code; errors exit 2.
  const loomDiags = validateLoomModel(loom, hostValidateOptions(file));
  const { errors: loomErrors, warnings: loomWarnings } = printIrDiagnostics(
    loomDiags,
    result.sourceTexts,
  );
  printSummary(ast, { errors: loomErrors.length, warnings: loomWarnings.length });
  if (loomErrors.length > 0) process.exit(2);
  if (loom.requirements.length === 0) {
    console.error(`No \`requirement\` declarations in ${file} — nothing to verify.`);
    process.exit(2);
  }

  // Read + validate every report.  Three readers: Loom's own
  // `{ version, results: [...] }` document (`--results`), a vitest/jest
  // `--reporter=json` report (`--from-vitest`) — what the generated node
  // backend's unit and api-e2e suites produce — and a Playwright
  // `--reporter=json` report (`--from-playwright`), what the generated ui-e2e
  // suite produces.  See `src/verify/from-*.ts`.
  const reports: LabelledReport[] = [];
  for (const input of inputs) {
    if (!fs.existsSync(input.path)) {
      console.error(`Results file not found: ${input.path} (${input.flag})`);
      process.exit(2);
    }
    try {
      reports.push({ label: `${input.flag} ${input.path}`, outcomes: readReport(input) });
    } catch (err) {
      const what =
        err instanceof VitestReportError
          ? "vitest report"
          : err instanceof PlaywrightReportError
            ? "Playwright report"
            : "results file";
      console.error(
        `Could not parse ${what} ${input.path}: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(2);
    }
  }
  const outcomes = reports.flatMap((r) => r.outcomes);

  // Every deployable slug in the model — the closed set of ` against <slug>`
  // suffixes an api-e2e title can carry (`src/system/e2e-render.ts` replays
  // one `test e2e` block per compatible backend).  Passing it lets the join
  // undo the suffix exactly instead of pattern-matching it.
  const serviceSlugs = loom.systems.flatMap((s) => s.deployables.map((d) => serviceSlug(d.name)));
  const execTests = loom.traceability!.execTests;

  const verification = computeVerification(
    loom.traceability!,
    loom.requirements.map((r) => r.id),
    outcomes,
    { serviceSlugs },
  );
  const attribution = attributeResults(loom.traceability!, outcomes, { serviceSlugs });

  // Emit artifacts.
  const outDir = path.join(path.resolve(options.out ?? path.dirname(file)), ".loom");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "verification.json"), renderVerificationJson(verification));
  fs.writeFileSync(path.join(outDir, "verification.md"), renderVerificationMd(loom, verification));
  fs.writeFileSync(path.join(outDir, "verification.mmd"), renderVerdictGraph(loom, verification));

  const s = verification.summary;

  // ── Evidence accounting ────────────────────────────────────────────
  //
  // A declared executable test with no matching result lands in the join as
  // `status: "missing"` and fails the gate below.  The summary line counts
  // three kinds of evidence problem separately, because each has a different
  // fix: a declared test with no result, a result no declared test claims
  // (a drifted title — `diagnostics.unknownTests`), and — not a problem, but
  // not evidence either — a result of a declared test whose block carries no
  // `verifies` (`diagnostics.unlinkedTests`).
  const missing = missingEvidence(execTests, attribution);
  const unknown = verification.diagnostics.unknownTests;
  const unlinked = verification.diagnostics.unlinkedTests;

  // A report that contributed nothing to the join is almost certainly the
  // wrong file; with several merged it would otherwise vanish silently.
  for (const w of reportWarnings(reports, attribution)) console.error(`warning: ${w}.`);

  // Under `--json` the human summary goes to stderr: stdout then carries the
  // verification document and nothing else, so `ddd verify --json | jq` works
  // the way `parse --json` / `generate system --json` do.  Without `--json`
  // the summary IS the output and stays on stdout.
  const evidence: string[] = [];
  if (missing.refs.length > 0)
    evidence.push(`${missing.refs.length} declared test(s) with no result`);
  if (unknown.length > 0) evidence.push(`${unknown.length} result(s) matching no declared test`);
  if (unlinked.length > 0) {
    evidence.push(`${unlinked.length} result(s) from declared tests with no \`verifies\``);
  }
  const fromReports = reports.length > 1 ? ` [${reports.length} reports merged]` : "";
  const summaryLine =
    `Verified ${s.verified}/${s.total} requirements ` +
    `(${s.failing} failing, ${s.unverified} unverified, ${s.untested} untested)` +
    (evidence.length > 0 ? ` — ${evidence.join(", ")}.` : ".") +
    fromReports;
  if (options.json) {
    console.error(summaryLine);
    console.log(renderVerificationJson(verification));
  } else {
    console.log(summaryLine);
  }

  // Gate.
  //
  // MISSING EVIDENCE FAILS BY DEFAULT.  "No result for a declared test" is not
  // "the test passed": a CI job whose runner wrote the wrong file, wrote
  // nothing, reported a `suite` string the join does not recognise, or whose
  // second report was never passed, must not go green having verified
  // nothing.  `--allow-missing` is the opt-out for the deliberately-partial
  // run (one suite of many, a staged rollout); it is named in the failure so
  // the migration is one flag.  This gate is strictly narrower than
  // `--require-all` (which also fails on skips and on requirements no test
  // covers).
  let failed = s.failing > 0;
  let reason = failed ? `${s.failing} requirement(s) failing` : "";
  if (missing.refs.length > 0 && !options.allowMissing) {
    failed = true;
    const sample = missing.refs
      .slice(0, 3)
      .map((m) => `${m.testCaseId} → "${m.name}"`)
      .join(", ");
    reason =
      `${missing.refs.length} declared test(s) had no matching result (${sample}` +
      `${missing.refs.length > 3 ? ", …" : ""})` +
      describeMissingCause(missing, attribution, execTests, serviceSlugs) +
      `; pass --allow-missing to accept a partial run`;
  }
  if (options.requireAll && s.verified < s.total) {
    failed = true;
    reason = `${s.total - s.verified} requirement(s) not verified (--require-all)`;
  }
  if (minPct !== undefined) {
    const actual = s.total === 0 ? 100 : (s.verified / s.total) * 100;
    if (actual < minPct) {
      failed = true;
      reason = `verified ${actual.toFixed(0)}% < --min ${minPct}%`;
    }
  }
  if (failed) {
    console.error(`Verification gate failed: ${reason}.`);
    process.exit(1);
  }
}

/** Registers `ddd verify` on the CLI program. */
export function registerVerifyCommand(program: Command): void {
  program
    .command("verify <file>")
    .description(
      "Join test-results reports onto the requirements graph, write .loom/verification.* and gate the exit code.",
    )
    .option(
      "--results <file>",
      "JSON file: { version, results: [{ name, status, suite? }] } (repeatable)",
      collectRepeated,
      [],
    )
    .option(
      "--from-vitest <file>",
      "read a vitest/jest `--reporter=json` report (repeatable)",
      collectRepeated,
      [],
    )
    .option(
      "--from-playwright <file>",
      "read a Playwright `--reporter=json` report (repeatable)",
      collectRepeated,
      [],
    )
    .option("--out <dir>", "output directory for .loom/ artifacts (default: the .ddd file's dir)")
    .option("--require-all", "fail unless every requirement is VERIFIED")
    .option("--min <pct>", "fail if the verified percentage is below <pct>")
    .option(
      "--allow-missing",
      "accept declared tests that produced no result (default: they fail the gate)",
    )
    .option("--json", "also print verification.json to stdout")
    .action(async (file: string, options: VerifyOptions) => {
      // Every report flag is repeatable and they mix freely: a generated tree's
      // unit and e2e tiers each write their own report, and the verdict needs
      // all of them.  Each one given is read — none is preferred over another.
      const inputs: ReportInput[] = [
        ...options.results.map((p) => ({ flag: "--results" as const, path: p })),
        ...options.fromVitest.map((p) => ({ flag: "--from-vitest" as const, path: p })),
        ...options.fromPlaywright.map((p) => ({ flag: "--from-playwright" as const, path: p })),
      ];
      if (inputs.length === 0) {
        console.error(
          "ddd verify needs test results: pass --results <file> (Loom's " +
            "{ version, results: [...] } document), --from-vitest <file> " +
            "(a vitest/jest --reporter=json report) or --from-playwright <file> " +
            "(a Playwright --reporter=json report) — each repeatable, one per runner report.",
        );
        process.exit(2);
      }
      await runVerify(file, inputs, options);
    });
}

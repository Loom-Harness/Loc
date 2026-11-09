import * as fs from "node:fs";
import * as path from "node:path";
import type { Command } from "commander";
import { annotateTrace, type SourceMap, traceCoverage } from "../../trace/index.js";

interface TraceOptions {
  map?: string;
  out?: string;
}

/** Resolve the `.loom/sourcemap.json` path per the discovery rule: an
 *  explicit `--map` wins; else `<--out dir>/.loom/sourcemap.json`; else
 *  `./.loom/sourcemap.json`. */
export function resolveMapPath(options: TraceOptions): string {
  if (options.map) return path.resolve(options.map);
  if (options.out) return path.join(path.resolve(options.out), ".loom", "sourcemap.json");
  return path.resolve(".loom", "sourcemap.json");
}

/** `ddd trace` — annotate a crash log / stack trace with the `.ddd`
 *  construct + source location each recognized frame maps to, via
 *  `.loom/sourcemap.json`. Best-effort: exits 0 whenever the map loads,
 *  same as `annotateTrace` itself — an unresolved frame passes through
 *  unchanged rather than failing the run. */
async function runTrace(file: string, options: TraceOptions): Promise<void> {
  const absolute = path.resolve(file);
  if (!fs.existsSync(absolute)) {
    console.error(`Log file not found: ${absolute}`);
    process.exit(1);
  }

  const mapPath = resolveMapPath(options);
  if (!fs.existsSync(mapPath)) {
    console.error(
      `Source map not found at ${mapPath}. Regenerate it with ` +
        "`ddd generate system <file> -o <out> --sourcemap`, or pass --map <path>.",
    );
    process.exit(1);
  }

  let map: SourceMap;
  try {
    map = JSON.parse(fs.readFileSync(mapPath, "utf8")) as SourceMap;
  } catch (err) {
    console.error(
      `Could not parse source map at ${mapPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  const logText = fs.readFileSync(absolute, "utf8");
  const readSource = (p: string): string | undefined => {
    try {
      return fs.readFileSync(p, "utf8");
    } catch {
      return undefined; // missing/moved source file — annotate.ts degrades to a byte span
    }
  };
  console.log(annotateTrace(logText, map, readSource));
  reportTraceCoverage(logText, map, mapPath);
}

/** Say what the annotation run actually did — on stderr, so the annotated log
 *  stays pipeable.
 *
 *  `annotateTrace` echoes an unresolvable frame unchanged, which made a total
 *  miss look like a successful no-op: a production stack whose every frame is
 *  `dist/index.js` came back byte-identical with no count, no reason and no
 *  next step.  The command HAS all three — it parsed the frames, it knows what
 *  the map covers, and it knows a bundle path can't match a generated source
 *  path. */
function reportTraceCoverage(logText: string, map: SourceMap, mapPath: string): void {
  const cov = traceCoverage(logText, map);
  const covered = Object.keys(map.files);
  if (cov.frames === 0) {
    console.error(
      "ddd trace: no stack frames recognized in this log (supported dialects: V8/Node, " +
        ".NET, Java, Python, Elixir) — nothing to annotate.",
    );
    return;
  }
  if (cov.resolved > 0) {
    console.error(`ddd trace: annotated ${cov.resolved} of ${cov.frames} stack frame(s).`);
    return;
  }

  const lines = [`ddd trace: no frame matched the sourcemap (0 of ${cov.frames} stack frame(s)).`];
  if (cov.unknownFiles.length > 0) {
    lines.push(`  frame files: ${cov.unknownFiles.slice(0, 4).join(", ")}`);
  }
  if (cov.lineMisses > 0) {
    lines.push(
      `  ${cov.lineMisses} frame(s) named a mapped file but no region covered their line — ` +
        "the map is likely older than the output; re-run `generate system … --sourcemap`.",
    );
  }
  lines.push(
    `  ${mapPath} covers ${covered.length} generated file(s)` +
      (covered.length > 0 ? `, e.g. ${covered.slice(0, 3).join(", ")}` : ""),
  );
  lines.push(
    "  A BUNDLED frame (dist/…, *.min.js, a single-file build) names the bundle, not the " +
      "generated file the map is keyed by. Run the process from the generated sources, or " +
      "resolve the bundle's own source map first (`node --enable-source-maps`), then re-run " +
      "`ddd trace`. If the log is from a different project tree, point at its map with --map " +
      "or -o.",
  );
  console.error(lines.join("\n"));
}

/** Registers `ddd trace` on the CLI program. */
export function registerTraceCommand(program: Command): void {
  program
    .command("trace <logfile>")
    .description(
      "Annotate a crash log / stack trace with the .ddd construct + source location each " +
        "frame maps to, via .loom/sourcemap.json. See docs/debugging.md.",
    )
    .option(
      "--map <path>",
      "explicit path to sourcemap.json (default: <out>/.loom/sourcemap.json, else ./.loom/sourcemap.json)",
    )
    .option(
      "-o, --out <dir>",
      "the directory the system was generated into (used to locate the map when --map is omitted)",
    )
    .action(async (logfile: string, options: TraceOptions) => {
      await runTrace(logfile, options);
    });
}

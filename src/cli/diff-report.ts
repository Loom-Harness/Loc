import type { DiffReport } from "../api/evolve.js";

// ---------------------------------------------------------------------------
// The human rendering of `ddd diff` — one line per change, led by its class,
// then the verdict.  `--json` prints the report itself instead.
// ---------------------------------------------------------------------------

/** Where the diff's baseline came from, as `ddd diff` reports it (and as the
 *  `baseline` field of its `--json` document). */
export type DiffBaseline =
  | { kind: "file"; path: string }
  | { kind: "git"; ref: string; path: string }
  | { kind: "chain"; dir: string };

/** `ddd diff --json`'s document: the toolkit `DiffReport` plus where the
 *  baseline came from. */
export interface DiffCommandReport extends DiffReport {
  baseline: DiffBaseline;
}

/** The exit code `ddd diff` answers with: 0 compatible, 1 breaking, 2 when it
 *  could not diff at all (a gate never reads "compatible" off a failure). */
export function diffExitCode(report: DiffReport): 0 | 1 | 2 {
  if (!report.ok) return 2;
  return report.breaking ? 1 : 0;
}

/** The baseline as one phrase, e.g. `HEAD~1:app.ddd`. */
export function describeDiffBaseline(b: DiffBaseline): string {
  switch (b.kind) {
    case "file":
      return b.path;
    case "git":
      return `${b.ref}:${b.path}`;
    case "chain":
      return `the migration chain in ${b.dir}`;
  }
}

const CLASS_WIDTH = "breaking-for-clients".length;
const tag = (cls: string) => cls.padEnd(CLASS_WIDTH);

/** The text `ddd diff` prints for a report that derived (`ok: true`). */
export function renderDiffReport(report: DiffCommandReport): string {
  const out: string[] = [`Diff against ${describeDiffBaseline(report.baseline)}:`];
  for (const c of report.wireChanges) {
    const retyped = c.kind === "property-type-changed" && c.from && c.to;
    const what = c.detail ?? `${c.kind} ${c.entity}`;
    out.push(`  ${tag(c.class)}  ${retyped ? `${what}: ${c.from} → ${c.to}` : what}`);
  }
  for (const m of report.migrations) {
    const head = m.destructive
      ? `module ${m.module}: ${m.steps.length} schema step(s), refused by the destructive gate without --allow-destructive`
      : `module ${m.module}: ${m.steps.length} schema step(s)`;
    out.push(`  ${tag(m.class)}  ${head}`);
    for (const s of m.steps) {
      for (const line of s.sql.split("\n")) out.push(`      ${line}`);
    }
  }
  if (report.wireChanges.length === 0 && report.migrations.length === 0) {
    out.push("  no wire or schema changes");
  }
  if (!report.breaking) {
    out.push("Compatible: no breaking change.");
  } else {
    const who = [
      report.breakingForClients ? "clients" : undefined,
      report.breakingForData ? "data" : undefined,
    ].filter((w) => w !== undefined);
    out.push(`BREAKING for ${who.join(" and ")}.`);
  }
  return `${out.join("\n")}\n`;
}

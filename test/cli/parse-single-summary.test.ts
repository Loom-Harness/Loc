// `ddd parse` reports ONE summary line, and it counts every phase.
//
// It reported two, and they contradicted each other (audit #2864
// § Papercuts / M-T9.60):
//
//     0 error(s), 0 warning(s).        ← phase ④, the AST validator
//     loom.named-lifecycle-dropped …
//     1 error(s).                      ← phase ⑦, the IR validator
//
// The failure mode is a reader, not a wrong number: someone who reads the
// first footer stops there, because a footer is where a command's verdict
// lives — and that footer says the model is clean while the command exits 1.
// The second line, arriving after a wall of diagnostics, reads as a count of
// whatever block precedes it rather than as the real verdict.
//
// So the phase printers print LINES and return their tallies, and the command
// prints one footer after the last phase it ran (`printSummary` in
// `src/cli/main.ts`).  What this suite pins:
//
//   1. exactly ONE summary line per run — not "the first one is right now";
//   2. its counts INCLUDE phase-⑦ diagnostics, which is the half that used to
//      be invisible to a reader who stopped at the first footer;
//   3. it comes AFTER the IR phase's output, so nothing that reads like a
//      verdict appears above a diagnostic the verdict is about;
//   4. a run that never reaches phase ⑦ (AST errors abort before lowering)
//      still prints exactly one, covering the phase that ran.
//
// Counting the summary lines — rather than asserting one expected string — is
// what makes this a gate on the CONTRADICTION rather than on today's wording:
// restoring either dropped footer fails it, whatever the second one says.

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const cli = path.join(repoRoot, "bin", "cli.js");

function parse(file: string): { stdout: string; stderr: string; status: number } {
  const r = spawnSync("node", [cli, "parse", file], { encoding: "utf8" });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? 1 };
}

function write(source: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-summary-"));
  const file = path.join(dir, "main.ddd");
  fs.writeFileSync(file, source);
  return file;
}

/** Every line that reads as a footer — the combined `N error(s), M warning(s).`
 *  AND the two single-count forms the phase printers used to emit on their own
 *  (`N error(s).` / `N warning(s).`).  A run must produce exactly one. */
const SUMMARY_LINE = /^(?:\d+ error\(s\), \d+ warning\(s\)\.|\d+ error\(s\)\.|\d+ warning\(s\)\.)$/;

function summaryLines(stream: string): string[] {
  return stream.split("\n").filter((l) => SUMMARY_LINE.test(l.trim()));
}

/** A model with no AST errors and three phase-⑦ WARNINGS: an `eventLog`
 *  resource nothing is persisted as (`loom.datasource-unused`) whose `every:` /
 *  `retain:` snapshot knobs no emitter reads (`loom.datasource-knob-unwired`
 *  ×2).  Phase ④ finds nothing here, so the old first footer said `0 error(s),
 *  0 warning(s).` about a file with three warnings. */
const IR_WARNED = `
system WarnSystem {
  subdomain D {
    context Orders {
      aggregate Order with crudish { code: string }
      repository Orders for Order { }
    }
  }
  storage pg { type: postgres }
  resource st { for: Orders, kind: state, use: pg }
  resource evtLog { for: Orders, kind: eventLog, use: pg, every: 100, retain: 3 }
  deployable d {
    platform: node
    contexts: [Orders]
    dataSources: [st, evtLog]
    port: 3000
  }
}
`;

/** The same model with the state binding removed — one phase-⑦ ERROR
 *  (`loom.persistence-mode-unsupported`) that phase ④ cannot see.  This is the
 *  audit's exact shape: a clean AST footer above a failing run. */
const IR_BROKEN = `
system Shop {
  subdomain D {
    context Orders {
      aggregate Order with crudish { code: string }
      repository Orders for Order { }
    }
  }
  storage pg { type: postgres }
  resource st { for: Orders, kind: state, use: pg }
  deployable d {
    platform: node
    contexts: [Orders]
    port: 3000
  }
}
`;

describe("ddd parse — one summary, counting every phase", () => {
  it("counts phase-⑦ warnings in the single summary on a clean-AST model", () => {
    const { stderr, status } = parse(write(IR_WARNED));
    expect(status).toBe(0);

    // The warnings are really there (a vacuous pass would otherwise assert
    // `0 error(s), 0 warning(s).` and call it correct).
    expect(stderr).toContain("loom.datasource-unused");
    expect(stderr).toContain("loom.datasource-knob-unwired");

    const lines = summaryLines(stderr);
    expect(lines, `expected exactly one summary, got: ${JSON.stringify(lines)}`).toHaveLength(1);
    // Phase ④ contributes 0/0 here, phase ⑦ contributes the three warnings —
    // so the ONE footer has to say 3, which is precisely what the old first
    // footer did not.
    expect(lines[0]).toBe("0 error(s), 3 warning(s).");
  });

  it("counts a phase-⑦ error in the single summary — no clean footer above it", () => {
    const { stderr, status } = parse(write(IR_BROKEN));
    expect(status).toBe(1);
    expect(stderr).toContain("loom.persistence-mode-unsupported");

    const lines = summaryLines(stderr);
    expect(lines, `expected exactly one summary, got: ${JSON.stringify(lines)}`).toHaveLength(1);
    expect(lines[0]).toBe("1 error(s), 0 warning(s).");
    // The specific lie the audit reported: a `0 error(s)` verdict on a run
    // that exits 1.
    expect(stderr).not.toContain("0 error(s), 0 warning(s).");
  });

  it("prints the summary AFTER the IR diagnostics it counts", () => {
    const { stderr } = parse(write(IR_BROKEN));
    const summary = stderr.indexOf("1 error(s), 0 warning(s).");
    const diagnostic = stderr.indexOf("loom.persistence-mode-unsupported");
    expect(summary).toBeGreaterThan(-1);
    expect(diagnostic).toBeGreaterThan(-1);
    expect(summary, "the verdict must not precede the diagnostic").toBeGreaterThan(diagnostic);
  });

  it("still prints exactly one summary when AST errors abort before lowering", () => {
    // Phase ⑦ never runs on this one — the summary covers phase ④ alone, and
    // there is still only one of it.
    const { stderr, status } = parse(write("context X {\n  aggregate A { b: }\n}\n"));
    expect(status).toBe(1);
    const lines = summaryLines(stderr);
    expect(lines, `expected exactly one summary, got: ${JSON.stringify(lines)}`).toHaveLength(1);
    expect(lines[0]).toMatch(/^\d+ error\(s\), \d+ warning\(s\)\.$/);
    expect(lines[0]).not.toBe("0 error(s), 0 warning(s).");
  });

  it("counts AST and IR diagnostics together on a model that has both", () => {
    // `find open(): Order[]` raises the phase-④ wire-shaped-list-query warning;
    // the eventLog knobs raise two phase-⑦ warnings.  One footer, all three —
    // the case where the two old footers were each individually truthful and
    // together said nothing a reader could use.
    const { stderr, status } = parse(
      write(`
system Both {
  subdomain D {
    context Orders {
      enum OrderStatus { Open Closed }
      aggregate Order with crudish { code: string  status: OrderStatus }
      repository Orders for Order {
        find open(): Order[] where this.status == OrderStatus.Open
      }
    }
  }
  storage pg { type: postgres }
  resource st { for: Orders, kind: state, use: pg }
  resource evtLog { for: Orders, kind: eventLog, use: pg, every: 100, retain: 3 }
  deployable d {
    platform: node
    contexts: [Orders]
    dataSources: [st, evtLog]
    port: 3000
  }
}
`),
    );
    expect(status).toBe(0);
    expect(stderr).toContain("wire-shaped list query");
    expect(stderr).toContain("loom.datasource-knob-unwired");

    const lines = summaryLines(stderr);
    expect(lines, `expected exactly one summary, got: ${JSON.stringify(lines)}`).toHaveLength(1);
    // 1 from phase ④ + 3 from phase ⑦.
    expect(lines[0]).toBe("0 error(s), 4 warning(s).");
  });

  it("keeps advisory index suggestions out of the counted warnings", () => {
    // `Suggestions (N):` has always been its own, uncounted footer; folding the
    // phase footers together must not quietly promote hints to warnings.
    const { stdout, stderr, status } = parse(path.join(repoRoot, "examples", "acme.ddd"));
    expect(status).toBe(0);
    expect(stdout).toContain("OK:");
    expect(stderr).toContain("Suggestions (");
    expect(summaryLines(stderr)).toHaveLength(1);
    const suggestions = stderr.slice(stderr.indexOf("Suggestions ("));
    expect(suggestions).not.toContain("warning:");
  });
});

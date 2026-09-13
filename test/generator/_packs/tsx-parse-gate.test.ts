// Every React pack's emitted .tsx must PARSE.
//
// `designs/mantine/v{7,9}/primitive-chart.hbs` wrote the JSX expression
// container as `yAxisProps={\{{ … }}` — a literal `{` followed by an escaped
// `{{`, so the emitted attribute opened with THREE braces and closed with two:
//
//     yAxisProps={{{ allowDecimals: !(…) }} />
//
// That is not a type error, it is a SYNTAX error — seven of them from one
// attribute (TS1136, TS1005, TS1381, TS1382 …) — and `ddd generate system`
// still reported `0 error(s), 0 warning(s)`.  Nothing in the fast tier parses
// emitted TSX, and the pack build matrices that would have caught it run a
// full `npm install` per pack in a docker leg, so the typo shipped in two
// packs at once.
//
// This gate is the missing SYNTAX FLOOR: it runs the TypeScript parser over
// every `.tsx` each React pack emits for one primitive-dense page.  No
// `npm install`, no type resolution, no network — a parse is all it takes to
// separate "this pack emits JavaScript" from "this pack emits characters".
// Packs are discovered from `designs/*/*/pack.json`, so a new React pack is
// covered the day it lands.
import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const DESIGNS_DIR = path.resolve(__dirname, "..", "..", "..", "designs");

/** Every built-in pack whose manifest renders JSX (absent `format` = react). */
function reactPacks(): ReadonlyArray<{ label: string; family: string }> {
  const found: Array<{ label: string; family: string }> = [];
  for (const family of fs.readdirSync(DESIGNS_DIR).sort()) {
    const familyDir = path.join(DESIGNS_DIR, family);
    if (!fs.statSync(familyDir).isDirectory()) continue;
    for (const version of fs.readdirSync(familyDir).sort()) {
      const manifestPath = path.join(familyDir, version, "pack.json");
      if (!fs.existsSync(manifestPath)) continue;
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { format?: string };
      if ((manifest.format ?? "react") !== "react") continue;
      found.push({ label: `${family}/${version}`, family });
    }
  }
  return found;
}

/** A page dense enough to reach the primitives whose templates are most
 *  likely to mis-balance a brace: a chart (the site that was broken), a table,
 *  a stat and a form. */
function source(design: string): string {
  return `
system X {
  subdomain S {
    context C {
      enum St { Open, Closed }
      aggregate Ticket with crudish {
        st: St
        weight: int
        derived display: string = "t"
      }
      repository Tickets for Ticket { }
      projection ByStatus {
        st: St
        tickets: int
        from Ticket as t
        group by t.st
        select st = t.st, tickets = count()
      }
    }
  }
  api TicketApi from S
  ui Web with scaffold(subdomains: [S]) {
    framework: react
    api S: TicketApi
    page Dash {
      route: "/dash"
      body: Stack {
        Chart { of: S.ByStatus, kind: "bar", x: r => r.st, y: r => r.tickets },
        Chart { of: S.ByStatus, kind: "line", x: r => r.st, y: r => r.tickets }
      }
    }
  }
  storage p { type: postgres }
  resource r { for: C, kind: state, use: p }
  deployable api { platform: node, contexts: [C], dataSources: [r], serves: TicketApi, port: 3000 }
  deployable web { platform: react, targets: api, ui: Web { S: api }, design: ${design}, port: 3001 }
}
`;
}

/** Syntax diagnostics only — no program, no type checker, no module
 *  resolution.  `parseDiagnostics` is populated by the scanner/parser, so this
 *  answers exactly one question: is the emitted text valid TSX? */
function parseErrors(fileName: string, text: string): string[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
  // `parseDiagnostics` is internal but stable, and is the only way to read
  // syntax errors without building a Program (which would need node_modules).
  const diags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  return diags.map((d) => {
    const pos = d.start != null ? sf.getLineAndCharacterOfPosition(d.start) : undefined;
    const where = pos ? `${pos.line + 1}:${pos.character + 1}` : "?";
    return `${fileName}(${where}): TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`;
  });
}

describe("react packs emit parseable TSX", () => {
  it.each(reactPacks())("$label", { timeout: 120_000 }, async ({ family }) => {
    const files = await generateSystemFiles(source(family));
    const tsx = [...files].filter(([p]) => p.endsWith(".tsx"));
    expect(tsx.length, `${family}: no .tsx emitted`).toBeGreaterThan(3);
    const errors = tsx.flatMap(([p, t]) => parseErrors(p, t));
    expect(errors, `${family} emitted unparseable TSX:\n${errors.join("\n")}`).toEqual([]);
  });

  it("reaches the chart primitive, and the parser really reports bad TSX", async () => {
    // Non-vacuity 1 — the model under test does emit the primitive that broke.
    const files = await generateSystemFiles(source("mantine"));
    const dash = [...files].find(([p]) => p.endsWith("pages/dash.tsx"))?.[1];
    expect(dash, "dash page not emitted").toBeDefined();
    expect(dash!).toContain("yAxisProps=");
    expect(dash!).toContain("BarChart");
    expect(dash!).toContain("LineChart");
    // Non-vacuity 2 — the detector flags the exact shape that shipped.
    const planted = parseErrors("planted.tsx", "const a = <X yAxisProps={{{ b: 1 }} />;");
    expect(planted.length).toBeGreaterThan(0);
  });
});

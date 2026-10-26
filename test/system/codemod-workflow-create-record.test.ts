// The codemod for the record-form factory cutover
// (`scripts/codemod-workflow-create-record.mjs`,
// `loom.workflow-positional-create`), and the tree gate that keeps the repo's
// own `.ddd` sources migrated.
//
// The first half drives the pure core over the shapes a real project has: a
// positional call mapped onto the property order, one mapped onto a declared
// `create(…)`'s parameters, the named form, the empty form, and the three
// refusals.  Every rewritten source must PARSE and VALIDATE clean and lower to
// a `create` effect that is saved — a codemod that emits something the
// compiler refuses fails here.  The second half walks every in-repo `.ddd`.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { rewriteFactoryCalls } from "../../scripts/codemod-workflow-create-record.mjs";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { allContexts } from "../../src/ir/types/loom-ir.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

const wrap = (members: string) => `system S {
  subdomain D {
    context C {
      aggregate Ticket with crudish {
        subject: string
        note: string?
        createdAt: datetime managed
      }
      repository Tickets for Ticket { }
      aggregate Poll {
        ticket: Ticket id
        label: string
        create(label: string, ticket: Ticket id) { }
      }
      repository Polls for Poll { }
      aggregate Counter with crudish { n: int = 0 }
      repository Counters for Counter { }
${members}
    }
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: node  contexts: [C]  dataSources: [st]  port: 3000 }
}`;

/** Parse + AST-validate + IR-validate; every error, from any phase. */
async function errorsOf(src: string): Promise<string[]> {
  const { model, errors } = await parseString(src);
  if (errors.length > 0) return errors;
  return validateLoomModel(enrichLoomModel(lowerModel(model)))
    .filter((d) => d.severity === "error")
    .map((d) => `${d.code}: ${d.message}`);
}

/** The aggregates the first workflow create / command handler creates and
 *  saves. */
async function savedCreates(src: string): Promise<string[]> {
  const { model } = await parseString(src);
  const ctx = allContexts(lowerModel(model))[0]!;
  const body = ctx.workflows[0]?.creates[0] ?? ctx.commandHandlers?.[0];
  return (body?.savesAtExit ?? []).map((s) => `${s.aggName} ${s.name}`);
}

describe("codemod-workflow-create-record — rewriteFactoryCalls", () => {
  it("maps a positional call onto the client-writable properties, in order", async () => {
    const src = wrap(`      workflow W {
        create(code: string) {
          let t = Ticket.create(code, "n")
        }
      }`);
    expect((await errorsOf(src)).join("\n")).toContain("'Ticket.create(…)' in a workflow body");
    const { text, changed, refused } = rewriteFactoryCalls(src);
    expect({ changed, refused }).toStrictEqual({ changed: 1, refused: [] });
    expect(text).toContain(`let t = Ticket.create({ subject: code, note: "n" })`);
    expect(await errorsOf(text)).toStrictEqual([]);
    expect(await savedCreates(text)).toStrictEqual(["Ticket t"]);
  });

  it("maps onto a declared create's parameters, not the property order", async () => {
    const src = wrap(`      commandHandler mk(t: Ticket id) { let p = Poll.create("x", t) }`);
    const { text, changed } = rewriteFactoryCalls(src);
    expect(changed).toBe(1);
    expect(text).toContain(`let p = Poll.create({ label: "x", ticket: t })`);
    expect(await errorsOf(text)).toStrictEqual([]);
    expect(await savedCreates(text)).toStrictEqual(["Poll p"]);
  });

  it("wraps the named form and the empty form", async () => {
    const src = wrap(`      workflow W {
        create(s: string) {
          let t = Ticket.create(subject: s, note: s)
          let c = Counter.create()
        }
      }`);
    const { text, changed } = rewriteFactoryCalls(src);
    expect(changed).toBe(2);
    expect(text).toContain(`let t = Ticket.create({ subject: s, note: s })`);
    expect(text).toContain(`let c = Counter.create({})`);
    expect(await errorsOf(text)).toStrictEqual([]);
    expect(await savedCreates(text)).toStrictEqual(["Ticket t", "Counter c"]);
  });

  it("leaves a record call, and calls outside a workflow / handler body, alone", () => {
    const src = wrap(`      workflow W {
        create(s: string) { let t = Ticket.create({ subject: s }) }
      }
      // Ticket.create(a, b) in a comment
      aggregate Other { x: string  operation f() { x := "Ticket.create(a)" } }
      repository Others for Other { }`);
    expect(rewriteFactoryCalls(src)).toStrictEqual({ text: src, changed: 0, refused: [] });
  });

  it("refuses, marks and keeps a call it cannot map faithfully", () => {
    const src = wrap(`      workflow W {
        create(s: string) {
          let t = Ticket.create(s)
          let u = Ticket.create(s, note: s)
          let p = Poll.create()
        }
      }`);
    const { text, changed, refused } = rewriteFactoryCalls(src);
    expect(changed).toBe(0);
    expect(refused.map((r) => r.call)).toStrictEqual([
      "Ticket.create(s)",
      "Ticket.create(s, note: s)",
      "Poll.create()",
    ]);
    expect(refused[0]!.reason).toContain("1 positional argument(s), but 'Ticket' has 2");
    expect(refused[1]!.reason).toBe("it mixes positional and named arguments");
    expect(refused[2]!.reason).toContain("'label', 'ticket'");
    expect(text.match(/codemod-workflow-create-record: not rewritten/g)).toHaveLength(3);
    expect(text).toContain("let t = Ticket.create(s)\n");
    // Idempotent: the markers are not added twice.
    expect(rewriteFactoryCalls(text).text).toBe(text);
  });
});

describe("codemod-workflow-create-record — the repo's own .ddd sources", () => {
  it("has nothing left to rewrite", () => {
    const skip = new Set(["node_modules", ".git", "dist", "out", ".loom"]);
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) {
          if (!skip.has(e.name)) walk(path.join(d, e.name));
        } else if (e.name.endsWith(".ddd")) files.push(path.join(d, e.name));
      }
    };
    walk(repoRoot);
    expect(files.length).toBeGreaterThan(200);
    const pending = files
      .map((f) => ({
        f: path.relative(repoRoot, f),
        r: rewriteFactoryCalls(fs.readFileSync(f, "utf8")),
      }))
      .filter(({ r }) => r.changed > 0 || r.refused.length > 0)
      .map(({ f }) => f);
    expect(pending).toStrictEqual([]);
  });
});

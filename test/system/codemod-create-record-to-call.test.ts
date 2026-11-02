// The codemod for the record-form factory-call hard cutover
// (`scripts/codemod-create-record-to-call.mjs`, D-CREATE-CALL-STYLE), and the
// tree gate that keeps the repo's own `.ddd` corpus migrated.
//
// The first half drives the pure core over the shapes a real project has: a
// one-line record, a multi-line one with a trailing comma, a nested call in a
// value, a record of value-object literals, an empty record, and the
// refusals (a record beside another argument, a key named twice).  Every
// rewritten source must PARSE and VALIDATE clean and lower to the same IR as
// the record it replaced — a codemod that emits something the compiler
// refuses, or that changes what a call means, fails here.  The second half
// walks every tracked `.ddd`, and every `.ddd` model embedded in a tracked
// `.ts` / `.mts` / `.mjs` literal or `.yml` / `.yaml` heredoc.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  declaredAggregates,
  rewriteCreateRecords,
  rewriteEmbedded,
  rewriteMarkdown,
} from "../../scripts/codemod-create-record-to-call.mjs";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

const wrap = (body: string) => `system S {
  user { id: string  role: string }
  subdomain D {
    context C {
      valueobject Money { amount: decimal  currency: string }
      aggregate Customer with crudish { name: string }
      repository Customers for Customer { }
      aggregate Order with crudish {
        customer: Customer id
        total: Money
        note: string
        test "builds" {
${body}
        }
      }
      repository Orders for Order { }
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

/** The lowered unit tests of `Order`, as JSON — what every backend emits from.
 *  Source spans differ between the two spellings, so `origin` is left out. */
async function testsIR(src: string): Promise<string> {
  const { model } = await parseString(src);
  const ctx = lowerModel(model).systems[0]?.subdomains[0]?.contexts[0];
  const order = ctx?.aggregates.find((a) => a.name === "Order");
  return JSON.stringify(order?.tests ?? [], (k, v) => (k === "origin" ? undefined : v));
}

describe("codemod-create-record-to-call — rewriteCreateRecords", () => {
  it("rewrites a one-line record into named arguments, lowering to the same IR", async () => {
    const src = wrap(
      `          let o = Order.create({ customer: "c1", total: Money { amount: 1.0, currency: "USD" }, note: "n" })`,
    );
    const { text, changed, refused } = rewriteCreateRecords(src);
    expect(changed).toBe(1);
    expect(refused).toEqual([]);
    expect(text).toBe(
      wrap(
        `          let o = Order.create(customer: "c1", total: Money { amount: 1.0, currency: "USD" }, note: "n")`,
      ),
    );
    expect(await errorsOf(text)).toEqual([]);
    expect(await testsIR(text)).toBe(await testsIR(src));
  });

  it("rewrites a multi-line record, keeping its lines and dropping a trailing comma", async () => {
    const src = wrap(`          let o = Order.create({
            customer: "c1",   // who
            total: Money { amount: 1.0, currency: "USD" },
            note: "n",
          })`);
    const { text, changed } = rewriteCreateRecords(src);
    expect(changed).toBe(1);
    expect(text).toBe(
      wrap(`          let o = Order.create(
            customer: "c1",   // who
            total: Money { amount: 1.0, currency: "USD" },
            note: "n"
          )`),
    );
    expect(await errorsOf(text)).toEqual([]);
    expect(await testsIR(text)).toBe(await testsIR(src));
  });

  it("keeps the author's key order, so the call means what the record meant", async () => {
    const src = wrap(
      `          let o = Order.create({ note: "n", total: Money { amount: 1.0, currency: "USD" }, customer: "c1" })`,
    );
    const { text } = rewriteCreateRecords(src);
    expect(text).toContain(`Order.create(note: "n", total: Money`);
    expect(await errorsOf(text)).toEqual([]);
    expect(await testsIR(text)).toBe(await testsIR(src));
  });

  it("rewrites a call nested in another call's record", () => {
    const src = `aggregate A { b: B id }
aggregate B { n: int }
let a = A.create({ b: B.create({ n: 1 }).id })`;
    const { text, changed } = rewriteCreateRecords(src);
    expect(changed).toBe(2);
    expect(text).toContain("let a = A.create(b: B.create(n: 1).id)");
  });

  it("rewrites an empty record to an empty call", () => {
    const { text } = rewriteCreateRecords(`aggregate A { }\nlet a = A.create({})`);
    expect(text).toBe(`aggregate A { }\nlet a = A.create()`);
  });

  it("leaves non-aggregate receivers, HTTP clients and value-object literals alone", () => {
    const src = `aggregate Order { n: int }
test e2e "x" against api {
  let o = api.orders.create({ n: 1 })
  let m = Money { amount: 1.0, currency: "USD" }
  let s = Store.create({ n: 1 })
}
// Order.create({ n: 1 }) in a comment
let t = "Order.create({ n: 1 }) in a string"`;
    expect(rewriteCreateRecords(src)).toEqual({ text: src, changed: 0, refused: [] });
  });

  it("uses the aggregate names it is given (a multi-file project)", () => {
    const { text, changed } = rewriteCreateRecords(
      `let o = Order.create({ n: 1 })`,
      new Set(["Order"]),
    );
    expect(changed).toBe(1);
    expect(text).toBe(`let o = Order.create(n: 1)`);
  });

  it("refuses a record beside another argument, and a key named twice, and marks them", () => {
    const src = `aggregate Order { n: int }
  let o = Order.create({ n: 1 }, 2)
  let p = Order.create({ n: 1, n: 2 })`;
    const { text, changed, refused } = rewriteCreateRecords(src);
    expect(changed).toBe(0);
    expect(refused.map((r) => [r.line, r.reason])).toEqual([
      [2, "'Order.create({ … }, …)' passes more than the record; rewrite it by hand"],
      [3, "'Order.create({ … })' names 'n' twice; pass each input once"],
    ]);
    expect(text).toContain(
      "  // codemod-create-record-to-call: not rewritten — 'Order.create({ … }, …)' passes more than the record; rewrite it by hand\n  let o = Order.create({ n: 1 }, 2)",
    );
    // Idempotent: the marker is written once.
    expect(rewriteCreateRecords(text).text).toBe(text);
  });

  it("is idempotent over call-form sources", () => {
    const src = `aggregate Order { n: int  m: int }
let o = Order.create(n: 1, m: 2)
let p = Order.create(1, 2)
let q = Order.create()`;
    expect(rewriteCreateRecords(src)).toEqual({ text: src, changed: 0, refused: [] });
  });

  it("finds the aggregates a source declares", () => {
    expect([
      ...declaredAggregates(`aggregate A { }\nabstract aggregate B { }\n// aggregate C { }`),
    ]).toEqual(["A", "B"]);
  });

  it("rewrites only fenced ddd blocks of a Markdown document", () => {
    const md = [
      "Call `Order.create({ n: 1 })` in prose stays.",
      "```ddd",
      "aggregate Order { n: int }",
      "let o = Order.create({ n: 1 })",
      "```",
      "```ts",
      "const o = Order.create({ n: 1 });",
      "```",
    ].join("\n");
    const { text, changed } = rewriteMarkdown(md);
    expect(changed).toBe(1);
    expect(text).toContain("let o = Order.create(n: 1)\n```");
    expect(text).toContain("Call `Order.create({ n: 1 })` in prose stays.");
    expect(text).toContain("const o = Order.create({ n: 1 });");
  });
});

describe("codemod-create-record-to-call — rewriteEmbedded", () => {
  const model = (call: string) =>
    `system S {\n  context C {\n    aggregate Order with crudish { n: int }\n    workflow W {\n      create(x: int) {\n        ${call}\n      }\n    }\n  }\n}`;

  it.each([
    ["a plain template", (m: string) => `const src = \`${m}\`;`],
    ["a tagged template", (m: string) => `const x = tag\`${m}\`;`],
    ["String.raw", (m: string) => `const x = String.raw\`${m}\`;`],
    ["a helper argument", (m: string) => `await run(\`${m}\`, { a: 1 });`],
    ["a hole in a template", (m: string) => `const x = \`pre \${f(\`${m}\`)} post\`;`],
    ["an array element", (m: string) => `const xs = [\`${m}\`];`],
  ])("rewrites a model held by %s", (_n, embed) => {
    const src = embed(model("let o = Order.create({ n: x })"));
    const r = rewriteEmbedded(src, "x.test.ts");
    expect(r.changed).toBe(1);
    expect(r.text).toBe(embed(model("let o = Order.create(n: x)")));
  });

  it("rewrites a heredoc model in a workflow", () => {
    const src = `jobs:\n  b:\n    steps:\n      - run: |\n          cat > m.ddd <<'EOF'\n${model("let o = Order.create({ n: x })")}\n          EOF\n`;
    const r = rewriteEmbedded(src, ".github/workflows/w.yml");
    expect(r.changed).toBe(1);
    expect(r.text).toContain("Order.create(n: x)");
  });

  it("leaves TypeScript that is no model, and a kept fixture, alone", () => {
    const code = `const o = Order.create({ n: 1 });\nconst s = "Order.create({ n: 1 })";`;
    expect(rewriteEmbedded(code, "a.ts")).toEqual({ text: code, changed: 0, refused: [] });
    const kept = `const m = \`${model("// codemod-create-record-to-call: keep\n        let o = Order.create({ n: x })")}\`;`;
    expect(rewriteEmbedded(kept, "a.ts")).toEqual({ text: kept, changed: 0, refused: [] });
  });

  it("reports the refusal line in the host file", () => {
    const src = `const a = 1;\nconst m = \`${model("let o = Order.create({ n: x }, 2)")}\`;`;
    expect(rewriteEmbedded(src, "a.ts").refused.map((r) => r.line)).toEqual([7]);
  });
});

describe("codemod-create-record-to-call — the tracked corpus is migrated", () => {
  const SKIP = new Set(["node_modules", ".git", "dist", "out", ".loom", ".claude"]);
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) walk(path.join(dir, e.name));
      } else if (e.name.endsWith(".ddd")) files.push(path.join(dir, e.name));
    }
  };
  walk(repoRoot);
  const aggregates = new Set<string>();
  for (const f of files) {
    for (const n of declaredAggregates(fs.readFileSync(f, "utf8"))) aggregates.add(n);
  }

  it("walks the corpus (vacuity guard)", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(aggregates.size).toBeGreaterThan(50);
  });

  it("no `.ddd` in the tree still calls an aggregate's create with a record", () => {
    const stale = files.filter((f) => {
      const r = rewriteCreateRecords(fs.readFileSync(f, "utf8"), aggregates);
      return r.changed > 0 || r.refused.length > 0;
    });
    expect(stale.map((f) => path.relative(repoRoot, f))).toEqual([]);
  });

  // Inline models: `.ts` / `.mts` / `.mjs` literals and `.yml` / `.yaml`
  // heredocs.  This file's own fixtures are record-form on purpose; every
  // other fixture that proves the refusal says so with a `keep` comment.
  const SELF = "test/system/codemod-create-record-to-call.test.ts";
  const embedding = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, maxBuffer: 1 << 28 })
    .toString()
    .split("\0")
    .filter((f) => /\.(?:m?ts|mjs|ya?ml)$/.test(f) && fs.existsSync(path.join(repoRoot, f)));

  it("walks the inline-model hosts (vacuity guard)", () => {
    expect(embedding.length).toBeGreaterThan(1000);
    expect(embedding.some((f) => f.startsWith(".github/workflows/") && f.endsWith(".yml"))).toBe(
      true,
    );
    // The own-fixture waiver is live: this file still holds record-form calls.
    expect(
      rewriteEmbedded(fs.readFileSync(path.join(repoRoot, SELF), "utf8"), SELF).changed,
    ).toBeGreaterThan(0);
    const hosts = embedding.filter((f) =>
      /\baggregate\s+\w+\s*(?:\{|with\b)/.test(fs.readFileSync(path.join(repoRoot, f), "utf8")),
    );
    expect(hosts.length).toBeGreaterThan(100);
  });

  it("no `.ts` / `.mjs` / `.yml` inline model still calls an aggregate's create with a record", () => {
    const stale = embedding.filter((f) => {
      if (f === SELF) return false;
      const r = rewriteEmbedded(fs.readFileSync(path.join(repoRoot, f), "utf8"), f);
      return r.changed > 0 || r.refused.length > 0;
    });
    expect(stale).toEqual([]);
  });
});

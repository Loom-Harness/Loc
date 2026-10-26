// The codemod for the workflow-`handle` hard cutover
// (`scripts/codemod-workflow-handle.mjs`, D-HANDLE-REMOVAL), and the tree gate
// that keeps the repo's own `.ddd` corpus migrated.
//
// The first half drives the pure core over the shapes a real project has: a
// gated handle beside a `create`, a `private` one, several in one workflow, a
// parameter that shadows a state field, and the three refusals (own-state
// read, `eventSourced`, a name clash).  Every lifted source must PARSE and
// VALIDATE clean and lower to a `commandHandler` carrying the handle's
// params / gate / body — a codemod that emits something the compiler refuses
// fails here.  The second half walks every tracked `.ddd`.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { liftWorkflowHandles } from "../../scripts/codemod-workflow-handle.mjs";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

const wrap = (members: string) => `system S {
  user { id: string  role: string }
  subdomain D {
    context C {
      aggregate Order with crudish {
        code: string
        open: bool
        operation close() { open := false }
      }
      repository Orders for Order { }
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

describe("codemod-workflow-handle — liftWorkflowHandles", () => {
  it("lifts a handle out of its workflow into a commandHandler after it", async () => {
    const src = wrap(`      workflow Settle {
        create(orderId: Order id) { let o = Orders.getById(orderId) }
        handle settle(orderId: Order id) {
          let o = Orders.getById(orderId)
          o.close()
        }
      }`);
    const { text, changed, refused } = liftWorkflowHandles(src);
    expect(changed).toBe(1);
    expect(refused).toEqual([]);
    expect(text).toBe(
      wrap(`      workflow Settle {
        create(orderId: Order id) { let o = Orders.getById(orderId) }
      }
      commandHandler settle(orderId: Order id) {
        let o = Orders.getById(orderId)
        o.close()
      }`),
    );
    expect(await errorsOf(text)).toEqual([]);
    const { model } = await parseString(text);
    const ctx = lowerModel(model).systems[0]?.subdomains[0]?.contexts[0];
    const h = ctx?.commandHandlers?.find((x) => x.name === "settle");
    expect(h?.params.map((p) => p.name)).toEqual(["orderId"]);
    expect(h?.statements.map((s) => s.kind)).toEqual(["repo-let", "op-call"]);
  });

  it("lifts every handle of a workflow and leaves an empty workflow valid", async () => {
    const src = wrap(`      workflow Ops {
        handle a(orderId: Order id) { let o = Orders.getById(orderId) }
        handle b(orderId: Order id) {
          let o = Orders.getById(orderId)
        }
      }`);
    const { text, changed } = liftWorkflowHandles(src);
    expect(changed).toBe(2);
    expect(text).toContain("      workflow Ops {\n      }\n");
    expect(text).toContain(
      "      commandHandler a(orderId: Order id) { let o = Orders.getById(orderId) }\n",
    );
    expect(text).toContain(
      "      commandHandler b(orderId: Order id) {\n        let o = Orders.getById(orderId)\n      }",
    );
    expect(text).not.toMatch(/\bhandle\b/);
    expect(await errorsOf(text)).toEqual([]);
  });

  it("refuses a gated or modified handle — a commandHandler takes no gate or modifier", () => {
    const gated = liftWorkflowHandles(
      wrap(`      workflow W {
        handle go(orderId: Order id) requires currentUser.role == "clerk" { let o = Orders.getById(orderId) }
      }`),
    );
    expect(gated.changed).toBe(0);
    expect(gated.refused[0]?.reason).toMatch(/`requires` gate/);
    const priv = liftWorkflowHandles(
      wrap(`      workflow W {
        private handle go(orderId: Order id) { let o = Orders.getById(orderId) }
      }`),
    );
    expect(priv.refused[0]?.reason).toBe("'private' is not allowed on a commandHandler");
    expect(priv.text).toContain("// codemod-workflow-handle: not lifted");
  });

  it("lifts a handle whose parameter shadows a state field of the same name", async () => {
    const src = wrap(`      workflow Track {
        orderId: Order id
        create(orderId: Order id) { orderId := orderId }
        handle poke(orderId: Order id) { let o = Orders.getById(orderId) }
      }`);
    const { text, changed, refused } = liftWorkflowHandles(src);
    expect(refused).toEqual([]);
    expect(changed).toBe(1);
    expect(await errorsOf(text)).toEqual([]);
  });

  it("refuses a handle that reads the workflow's own state, and marks it", () => {
    const src = wrap(`      workflow Approve {
        st: string
        handle approve() { st := "Approved" }
      }`);
    const { text, changed, refused } = liftWorkflowHandles(src);
    expect(changed).toBe(0);
    expect(refused).toEqual([
      { workflow: "Approve", handle: "approve", reason: "it reads the workflow's own 'st'" },
    ]);
    expect(text).toContain(
      "        // codemod-workflow-handle: not lifted — it reads the workflow's own 'st'\n        handle approve()",
    );
    // Idempotent: the marker is written once.
    expect(liftWorkflowHandles(text).text).toBe(text);
  });

  it("refuses a handle that calls a workflow helper or reads `this`", () => {
    const helper = liftWorkflowHandles(
      wrap(`      workflow W {
        function twice(n: int): int = n * 2
        handle go(n: int) { let m = twice(n) }
      }`),
    );
    expect(helper.refused.map((r) => r.reason)).toEqual(["it reads the workflow's own 'twice'"]);
    const self = liftWorkflowHandles(
      wrap(`      workflow W {
        handle go(n: int) { let m = this }
      }`),
    );
    expect(self.refused.map((r) => r.reason)).toEqual(["it reads the workflow's own `this`"]);
  });

  it("refuses a reserved `id` parameter and a body that reaches two aggregates", () => {
    const reserved = liftWorkflowHandles(
      wrap(`      workflow W {
        handle go(id: Order id) { let o = Orders.getById(id) }
      }`),
    );
    expect(reserved.refused[0]?.reason).toMatch(/named 'id'/);
    const two = liftWorkflowHandles(
      wrap(`      aggregate Note with crudish { body: string }
      repository Notes for Note { }
      workflow W {
        handle go(orderId: Order id) {
          let o = Orders.getById(orderId)
          let n = Note.create(body: "x")
        }
      }`),
    );
    expect(two.refused[0]?.reason).toBe(
      "it touches 2 aggregates (Order, Note), and a commandHandler orchestrates one",
    );
  });

  it("refuses every handle of an eventSourced workflow", () => {
    const { changed, refused } = liftWorkflowHandles(
      wrap(`      workflow Ledger eventSourced {
        handle post(orderId: Order id) { let o = Orders.getById(orderId) }
      }`),
    );
    expect(changed).toBe(0);
    expect(refused[0]?.reason).toMatch(/eventSourced/);
  });

  it("refuses a name an existing handler (or an earlier lifted handle) already holds", () => {
    const { text, changed, refused } = liftWorkflowHandles(
      wrap(`      commandHandler settle(orderId: Order id) { let o = Orders.getById(orderId) }
      workflow A {
        handle settle(orderId: Order id) { let o = Orders.getById(orderId) }
        handle other(orderId: Order id) { let o = Orders.getById(orderId) }
      }
      workflow B {
        handle other(orderId: Order id) { let o = Orders.getById(orderId) }
      }`),
    );
    expect(changed).toBe(1);
    expect(refused.map((r) => `${r.workflow}.${r.handle}`)).toEqual(["A.settle", "B.other"]);
    expect(text.match(/commandHandler other\(/g)).toHaveLength(1);
  });

  it("leaves a source with no workflow handle byte-identical", () => {
    const src = wrap(`      // workflow W { handle go() { } }
      workflow W {
        create(orderId: Order id) { let o = Orders.getById(orderId) }
      }
      commandHandler handle(orderId: Order id) { let o = Orders.getById(orderId) }`);
    expect(liftWorkflowHandles(src)).toEqual({ text: src, changed: 0, refused: [] });
  });
});

describe("codemod-workflow-handle — the tracked corpus is migrated", () => {
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

  it("walks the corpus (vacuity guard)", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("no `.ddd` in the tree still declares a workflow handle", () => {
    const stale = files.filter((f) => {
      const r = liftWorkflowHandles(fs.readFileSync(f, "utf8"));
      return r.changed > 0 || r.refused.length > 0;
    });
    expect(stale.map((f) => path.relative(repoRoot, f))).toEqual([]);
  });
});

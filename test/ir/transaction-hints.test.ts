// Two advisories that show a transaction boundary the source does not:
// `loom.handler-effect-in-transaction` (an outside effect inside a command
// handler's one transaction, from the read/effect flag on each resource verb)
// and `loom.workflow-partial-commit` (a non-transactional workflow that can
// commit part of its work, from the plan's `workflowPartialCommits`).  Both
// ride the `Suggestions:` channel, so neither fails a build.

import { describe, expect, it } from "vitest";
import { isAdvisoryCode } from "../../src/diagnostics/advisory.js";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { workflowPartialCommits } from "../../src/ir/plan/index.js";
import { RESOURCE_VERBS } from "../../src/ir/resource-verbs.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

async function lowered(src: string) {
  const { model } = await parseString(src, { validate: false });
  return enrichLoomModel(lowerModel(model));
}

const handlerSys = (body: string) => `
system S {
  subdomain D { context Billing {
    aggregate Invoice with crudish { email: string }
    repository Invoices for Invoice { }
    commandHandler Run(email: string): int {
      ${body}
      return 1
    }
  } }
  api A from D { route POST "/run/{email}" -> Billing.Run }
  storage pg { type: postgres }
  storage box { type: smtp, config: { from: "billing@rm.test" } }
  storage blobs { type: s3, config: { bucket: "b" } }
  resource st { for: Billing, kind: state, use: pg }
  resource mail { for: Billing, kind: mailer, use: box }
  resource files { for: Billing, kind: objectStore, use: blobs }
  deployable d { platform: node, contexts: [Billing], dataSources: [st, mail, files], serves: A, port: 4000 }
}`;

const hints = async (src: string, code: string) =>
  validateLoomModel(await lowered(src)).filter((d) => d.code === code);

describe("loom.handler-effect-in-transaction", () => {
  const CODE = "loom.handler-effect-in-transaction";

  it("names an effect verb (send, put) in a command handler", async () => {
    const hits = await hints(
      handlerSys(`mail.send(email, "Hi", "Body")
      files.put(email, "x")`),
      CODE,
    );
    expect(hits.map((h) => h.message)).toEqual([
      expect.stringContaining("'mail.send(…)' causes an outside effect"),
      expect.stringContaining("'files.put(…)' causes an outside effect"),
    ]);
    expect(hits.every((h) => h.severity === "warning" && isAdvisoryCode(h.code))).toBe(true);
  });

  it("stays quiet on a read the handler needs (get)", async () => {
    expect(await hints(handlerSys(`let doc = files.get(email)`), CODE)).toEqual([]);
  });

  it("every resource verb declares read or effect", () => {
    const unflagged = RESOURCE_VERBS.filter((v) => typeof v.effect !== "boolean");
    expect(unflagged).toEqual([]);
  });
});

const wfSys = (wf: string) => `
system S {
  subdomain M { context C {
    aggregate Item with crudish {
      qty: int
      operation take() { precondition qty > 0  qty := qty - 1 }
    }
    criterion Any of Item = qty >= 0
    repository Items for Item { }
    ${wf}
  } }
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable api { platform: node, contexts: [C], dataSources: [st], port: 3000 }
}`;

const LOOP = `for x in Items.all(Any, page: { offset: 0, limit: 50 }) { x.take() }`;

async function points(wf: string) {
  const loom = await lowered(wfSys(wf));
  const w = loom.systems[0]!.subdomains[0]!.contexts[0]!.workflows[0]!;
  return workflowPartialCommits(w);
}

describe("workflowPartialCommits / loom.workflow-partial-commit", () => {
  it("a writing loop commits as it goes", async () => {
    expect(await points(`workflow drain { create() { ${LOOP} } }`)).toEqual([
      { kind: "loop", aggregates: ["Item"] },
    ]);
    const hits = await hints(
      wfSys(`workflow drain { create() { ${LOOP} } }`),
      "loom.workflow-partial-commit",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.message).toContain("a loop saving Item");
    expect(isAdvisoryCode(hits[0]!.code)).toBe(true);
  });

  it("a writing branch followed by more work commits before that work", async () => {
    expect(
      await points(`workflow bump {
        create(a: Item id, b: Item id) {
          let x = Items.get(a)
          if x.qty > 0 { x.take() }
          let y = Items.get(b)
          y.take()
        }
      }`),
    ).toEqual([{ kind: "branch", aggregates: ["Item"] }]);
  });

  it("a writing branch as the last step commits last: no partial commit", async () => {
    expect(
      await points(`workflow bump {
        create(a: Item id) {
          let x = Items.get(a)
          if x.qty > 0 { x.take() }
        }
      }`),
    ).toEqual([]);
  });

  it("a straight-line body saves at exit, after every guard: none", async () => {
    expect(
      await points(`workflow bump { create(a: Item id) { let x = Items.get(a)  x.take() } }`),
    ).toEqual([]);
  });

  it("a transactional workflow rolls back as a whole: none", async () => {
    expect(await points(`workflow drain transactional { create() { ${LOOP} } }`)).toEqual([]);
  });
});

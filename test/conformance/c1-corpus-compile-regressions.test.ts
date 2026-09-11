// Wave C1 fold — five corpus compile-leg failures that the per-PR unit gates
// could not see, each pinned here on the EMITTED text so the fast suite catches
// the class before the docker legs run:
//
//   corpus × dotnet (Dapper)  `paged-nonrelational`: the Dapper mirror of the
//                             document / event-log repository had no paged arm
//                             (CS0535 + CS0029 — the EF path had one since 1e-i)
//   corpus × java             `workflow-create-state`: the correlation field's
//                             ASSIGNMENT spelling rendered `state.setOrderId(…)`
//                             against a JPA key with no setter;
//                             `workflow-primitive-params`: a VO-typed workflow
//                             param needs `<Vo>Request`, which only aggregate
//                             packages emitted — none here carries `Money`
//   corpus × python           `domain-services`: the aggregate module imported
//                             the domain service only the HOISTED `requires`
//                             gate reads (ruff F401); `workflow-primitive-params`:
//                             every create param was bound to a local whether
//                             the body read it or not (F841), and `UTC` was
//                             imported on a `datetime` PARAM (F401).
//   corpus × elixir           `workflow-create-state`: the as-loaded row was
//                             bound as `__loom_state` and then READ — Elixir
//                             warns on a read of an underscore-prefixed
//                             variable, and the leg compiles with
//                             `--warnings-as-errors` (behavioral-java's
//                             `gradle test produced no results` was the java
//                             row above).
//
// Each assertion below was RED on `f4f9a8d` (the nine-packet fold) and is green
// on the fix; the compile proof is the corresponding docker leg.

import { describe, expect, it } from "vitest";
import { generateCorpusCase } from "../fixtures/corpus/harness.js";

function bySuffix(files: Map<string, string>, suffix: string): string {
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  expect(key, `no emitted file ends in ${suffix}`).toBeTypeOf("string");
  return files.get(key!)!;
}

describe("dotnet (Dapper) — a paged find over a non-relational carrier implements the paged contract", () => {
  it.each([
    ["shape: document", "Infrastructure/Repositories/InvoiceRepository.cs", "InRegion"],
    ["persistedAs: eventLog", "Infrastructure/Repositories/AccountRepository.cs", "ByOwner"],
  ])("%s", async (_carrier, file, method) => {
    const files = await generateCorpusCase("paged-nonrelational", "dotnet", "dapper");
    const impl = bySuffix(files, file);
    const sig = impl.split("\n").find((l) => l.includes(`> ${method}(`));
    expect(sig, `no ${method} signature in the Dapper repository`).toBeTypeOf("string");
    for (const control of ["int page", "int pageSize", "string sort", "string dir"]) {
      expect(sig, `Dapper ${method} omits '${control}'`).toContain(control);
    }
    expect(impl).toContain(`return new Paged<`);
    // The Dapper mirrors carry no logger — the EF arm's `_log` line must not
    // be copied in (CS0103 was the second failure on this leg).
    expect(impl).not.toContain("_log.");
  });
});

describe("java — the correlation key is never re-set through a setter the state entity lacks", () => {
  it("workflow-create-state: `escalatedOrder := order` renders no `setEscalatedOrder`", async () => {
    const files = await generateCorpusCase("workflow-create-state", "java");
    const svc = bySuffix(files, "application/workflows/FulfilWorkflows.java");
    expect(svc).toContain("var __key = order;");
    expect(svc).not.toContain("setEscalatedOrder(");
    // The non-key own-state write still goes through its setter.
    expect(svc).toContain("state.setLevel(1);");
  });
});

describe("java — a VO-typed workflow param gets its Request record in the workflows package", () => {
  it("workflow-primitive-params: `MoneyRequest` is emitted beside the workflow request", async () => {
    const files = await generateCorpusCase("workflow-primitive-params", "java");
    const rec = bySuffix(files, "application/workflows/MoneyRequest.java");
    expect(rec).toContain("public record MoneyRequest(");
    const req = bySuffix(files, "application/workflows/TopUpRequest.java");
    expect(req).toContain("@Valid MoneyRequest amount");
  });
});

describe("python — the generated modules are ruff-clean on the two shapes that were not", () => {
  it("domain-services: the aggregate module does not import the service only the hoisted gate reads", async () => {
    const files = await generateCorpusCase("domain-services", "python");
    const agg = bySuffix(files, "app/domain/account.py");
    expect(agg).not.toContain("from app.domain.services.fee_quote import for_amount");
    // …while the route module, which renders the gate, still does.
    const routes = bySuffix(files, "app/http/account_routes.py");
    expect(routes).toContain("from app.domain.services.fee_quote import for_amount");
    expect(routes).toContain("for_amount(");
  });

  it("workflow-primitive-params: only the params the body reads are bound, and UTC is not imported", async () => {
    const files = await generateCorpusCase("workflow-primitive-params", "python");
    const routes = bySuffix(files, "app/http/workflows_routes.py");
    for (const read of ["holder", "qty", "flag", "tier"]) {
      expect(routes).toContain(`${read} = body.${read}`);
    }
    for (const unread of ["serial", "ratio", "at", "amount", "memo"]) {
      expect(routes, `'${unread}' is never read by the body`).not.toContain(
        `${unread} = body.${unread}`,
      );
    }
    expect(routes).toContain("from datetime import datetime");
    expect(routes).not.toMatch(/from datetime import .*\bUTC\b/);
  });
});

describe("elixir — the as-loaded workflow row is bound to a name mix may read", () => {
  it("workflow-create-state: no underscore-prefixed variable is read after being set", async () => {
    const files = await generateCorpusCase("workflow-create-state", "vanilla");
    const wfs = [...files.entries()].filter(([k]) => /\/workflows\/[a-z_]+\.ex$/.test(k));
    expect(wfs.length).toBeGreaterThan(0);
    for (const [k, src] of wfs) {
      expect(src, k).not.toContain("__loom_state");
      // `_name = …` may only be a discard — a later read of the same `_name`
      // is exactly the warning the leg turns into an error.
      const bound = [...src.matchAll(/^\s*(_[a-z][a-z0-9_]*)\s*=[^=]/gm)].map((m) => m[1]);
      for (const name of bound) {
        const reads = src.split(name).length - 1;
        expect(reads, `${k}: \`${name}\` is read after being set`).toBe(1);
      }
    }
    expect(bySuffix(files, "workflows/escalation.ex")).toContain("state = loom_state");
  });
});

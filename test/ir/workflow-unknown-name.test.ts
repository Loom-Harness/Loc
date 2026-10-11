// `loom.workflow-unknown-name` — an unresolved name anywhere in a workflow body.
//
// Claims eval D3: a workflow body that "reads a projection"
//
//     projection Seen keyed by p { … }
//     workflow W { create(p: P id) { let s = Seen.byKey(p)  precondition s.at < now() + days(1) } }
//
// validated with ZERO diagnostics, and every backend emitted the unresolved
// receiver verbatim (node `Seen.byKey(p)`, python `Seen`, .NET `Seen.ByKey`,
// java `Seen.byKey`, elixir `seen.by_key`).  The gate only looked at a
// `precondition` / `requires` whose WHOLE expression was a bare unknown ref, so
// an unresolved RECEIVER inside a `let` walked straight through.  A workflow
// loads data only through its own context's repositories; a projection has
// none.

import { describe, expect, it } from "vitest";
import { isAdvisoryCode } from "../../src/diagnostics/advisory.js";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/index.js";

const CODE = "loom.workflow-unknown-name";

const src = (extra: string, body: string) => `
  system S { subdomain M { context C {
    aggregate P with crudish { name: string  operation go() { emit Went { p: id, at: now() } } }
    repository Ps for P { }
    event Went { p: P id, at: datetime }
    projection Seen keyed by p { p: P id  at: datetime  on(e: Went) { p := e.p  at := e.at } }
    ${extra}
    workflow W {
      create(p: P id) {
        ${body}
      }
    }
  }}}`;

async function diags(extra: string, body: string) {
  const { model } = await parseString(src(extra, body), { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model))).filter(
    (d) => !isAdvisoryCode(d.code),
  );
}

describe("loom.workflow-unknown-name (IR, phase ⑦)", () => {
  it("refuses a projection read as a let-bound receiver (the D3 repro)", async () => {
    const ds = await diags("", "let s = Seen.byKey(p)  precondition s.at < now() + days(1)");
    const hits = ds.filter((d) => d.code === CODE);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.message).toContain("reads projection 'Seen'");
    expect(hits[0]?.message).toContain("own context's repositories");
    expect(hits[0]?.message).toContain("GET endpoint");
  });

  it("refuses it nested in an `if let` branch too", async () => {
    const ds = await diags(
      `aggregate R { p: P id  operation off() { p := p } }
       repository Rs for R { }
       criterion ForP(k: P id) of R = p == k`,
      `if let r = Rs.find(ForP(p)) {
          precondition Seen.byKey(p).at < now()
        }`,
    );
    expect(ds.map((d) => d.code)).toContain(CODE);
  });

  it("refuses an unresolved non-projection receiver with the generic message", async () => {
    const ds = await diags("", "let s = Nowhere.lookup(p)");
    const hit = ds.find((d) => d.code === CODE);
    expect(hit?.message).toBe("workflow 'W': let 's' references unknown name 'Nowhere'.");
  });

  it("still refuses a bare unknown name as a whole precondition (the original shape)", async () => {
    const ds = await diags("", "precondition ready");
    const hit = ds.find((d) => d.code === CODE);
    expect(hit?.message).toBe("workflow 'W': precondition references unknown name 'ready'.");
  });

  it("leaves an inline repository read to its own, more specific gate", async () => {
    const ds = await diags("", 'precondition Ps.getById(p).name != ""');
    const codes = ds.map((d) => d.code);
    expect(codes).toContain("loom.workflow-inline-repository-call");
    expect(codes).not.toContain(CODE);
  });

  it("accepts the supported spelling — a replica aggregate read through its repository", async () => {
    const ds = await diags(
      `aggregate SeenReplica { p: P id immutable  unique (p)  at: datetime }
       repository SeenReplicas for SeenReplica { }
       criterion ForP(k: P id) of SeenReplica = p == k
       workflow replicateSeen {
         p: P id
         create(e: Went) by e.p { let r = SeenReplica.create({ p: e.p, at: e.at }) }
       }`,
      `if let s = SeenReplicas.find(ForP(p)) {
          precondition s.at < now() + days(1)
        } else {
          precondition false message "never seen"
        }`,
    );
    expect(ds.map((d) => `${d.code} @ ${d.source}: ${d.message}`)).toEqual([]);
  });
});

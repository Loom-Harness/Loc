// loom.list-find-removed (D-LIST-FIND-REMOVED).
//
// A LIST `find` on a repository (returns `T[]` or `T paged`) is an error: a
// list read is `Repo.run(<Criterion>)` / a `retrieval`.  A unique-key
// reconstitution find (single `T` / `T?`) is not a list query and stays clean,
// and so does `find all(…)`, the author's override of the list endpoint.

import { describe, expect, it } from "vitest";
import type { LspDiagnostic as Diagnostic } from "../../_helpers/diagnostics.js";
import { parseString } from "../../_helpers/parse.js";

const CODE = "loom.list-find-removed";

const SYS = (finds: string): string => `
system S {
  subdomain Sales {
    context Orders {
      aggregate Order { code: string  region: string }
      repository Orders for Order {
        ${finds}
      }
      criterion InRegion(rgn: string) of Order = region == rgn
    }
  }
  api A from Sales
  storage pg { type: postgres }
  resource s { for: Orders, kind: state, use: pg }
  deployable d { platform: node  contexts: [Orders]  dataSources: [s]  serves: A  port: 3000 }
}`;

async function hits(finds: string): Promise<Diagnostic[]> {
  const { diagnostics } = await parseString(SYS(finds));
  return (diagnostics as Diagnostic[]).filter((d) => d.code === CODE);
}

describe("loom.list-find-removed", () => {
  it("is an error on a list find returning T[]", async () => {
    const found = await hits("find byRegion(rgn: string): Order[] where this.region == rgn");
    expect(found).toHaveLength(1);
    expect(found[0]!.severity).toBe(1);
    expect(found[0]!.message).toContain("repository find 'byRegion' returns a list");
    expect(found[0]!.message).toContain("codemod-list-find-to-criterion.mjs");
    expect(found[0]!.message).toContain("scaffoldPaged(of: <it>)");
    expect(found[0]!.message).toContain("scaffoldPagedApi(of: <it>)");
  });

  it("is an error on a paged list find (T paged)", async () => {
    const found = await hits("find recent(): Order paged");
    expect(found.map((d) => d.severity)).toEqual([1]);
  });

  it("does not fire on a unique-key reconstitution find (T? / T)", async () => {
    expect(await hits("find bySlug(slug: string): Order?")).toEqual([]);
    expect(await hits("find getOne(id: string): Order")).toEqual([]);
  });

  it("does not fire on `find all`, the list endpoint's override", async () => {
    expect(await hits('find all(): Order[] where this.region == "eu"')).toEqual([]);
  });

  it("does not fire for the implicit auto-findAll (synthesized, not author-declared)", async () => {
    // A repo with NO declared finds still gets the enrich-synthesized paged
    // `all` — but that's an IR-level find, never an AST FindDecl, so this
    // AST-level gate can't (and shouldn't) see it.
    expect(await hits("")).toEqual([]);
  });
});

// The scaffold macros must not GENERATE the removed construct — a scaffold
// emits the criterion-driven read path (scaffoldPaged → a queryHandler over
// Repo.run(<Criterion>)), never a bespoke list `find`.  These fixtures declare
// NO author finds, so a hit could only come from the scaffold expansion.
describe("scaffolds do not generate a list find", () => {
  async function fires(src: string): Promise<boolean> {
    const { diagnostics } = await parseString(src);
    return (diagnostics as Diagnostic[]).some((d) => d.code === CODE);
  }

  it("scaffoldPaged emits run(criterion), not a list find", async () => {
    const src = `
system S {
  subdomain Sales {
    context Orders with scaffoldPaged(of: InRegion) {
      aggregate Order { code: string  region: string }
      repository Orders for Order { }
      criterion InRegion(rgn: string) of Order = region == rgn
    }
  }
  api A with scaffoldPagedApi(of: InRegion) from Sales
  storage pg { type: postgres }
  resource s { for: Orders, kind: state, use: pg }
  deployable d { platform: node  contexts: [Orders]  dataSources: [s]  serves: A  port: 3000 }
}`;
    expect(await fires(src)).toBe(false);
  });

  it("scaffoldHandlers + crudish mint no list finds", async () => {
    const src = `
system S {
  subdomain Sales {
    context Orders with scaffoldHandlers {
      aggregate Order with crudish { code: string  status: string }
      repository Orders for Order { }
    }
  }
  api A with scaffoldApi(of: Sales)
  storage pg { type: postgres }
  resource s { for: Orders, kind: state, use: pg }
  deployable d { platform: node  contexts: [Orders]  dataSources: [s]  serves: A  port: 3000 }
}`;
    expect(await fires(src)).toBe(false);
  });
});

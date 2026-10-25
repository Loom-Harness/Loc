// loom.criterion-retrieval-name-clash (D-LIST-FIND-REMOVED).
//
// A criterion and a retrieval sharing a name in one context are an error:
// `Repo.run(<Name>)`, `scaffoldPaged(of: <Name>)` and a retrieval's
// `where: <Name>` all resolve the bare name, so a name meaning both would have
// to pick one silently.

import { describe, expect, it } from "vitest";
import type { LspDiagnostic as Diagnostic } from "../../_helpers/diagnostics.js";
import { parseString } from "../../_helpers/parse.js";

const SYS = (members: string): string => `
system S {
  subdomain Sales {
    context Orders {
      aggregate Order { code: string  region: string }
      repository Orders for Order { }
      criterion InRegion(rgn: string) of Order = region == rgn
      ${members}
    }
    context Other {
      aggregate Thing { code: string }
      repository Things for Thing { }
      ${members.includes("OtherCtx") ? 'retrieval InRegion of Thing = this.code == "x"' : ""}
    }
  }
  api A from Sales
  storage pg { type: postgres }
  resource s { for: Orders, kind: state, use: pg }
  resource t { for: Other, kind: state, use: pg }
  deployable d { platform: node  contexts: [Orders, Other]  dataSources: [s, t]  serves: A  port: 3000 }
}`;

async function diags(members: string): Promise<Diagnostic[]> {
  const { diagnostics } = await parseString(SYS(members));
  return diagnostics as Diagnostic[];
}

const CLASH = "loom.criterion-retrieval-name-clash";

describe("loom.criterion-retrieval-name-clash", () => {
  it("is an error when a retrieval reuses a criterion's name", async () => {
    const hit = (
      await diags(
        "retrieval InRegion(rgn: string) of Order { where: this.region == rgn  sort: [code asc] }",
      )
    ).find((d) => d.code === CLASH);
    expect(hit?.severity).toBe(1);
    expect(hit?.message).toContain("'InRegion'");
    expect(hit?.message).toContain("'Orders'");
  });

  it("is quiet when the names differ", async () => {
    const codes = (
      await diags(
        "retrieval InRegionSorted(rgn: string) of Order { where: InRegion(rgn)  sort: [code asc] }",
      )
    ).map((d) => d.code);
    expect(codes).not.toContain(CLASH);
  });

  it("is per context: the same name in another context is not a clash", async () => {
    const codes = (await diags("// OtherCtx")).map((d) => d.code);
    expect(codes).not.toContain(CLASH);
  });
});

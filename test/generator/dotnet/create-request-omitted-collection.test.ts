// An omitted non-nullable collection on a CREATE body is the empty collection —
// node's create-body `.default([])`, `createOmissionValue`'s `empty-collection`
// arm.  .NET carries it as a nullable request param (an empty collection
// expression is not a C# parameter-default constant) that the controller
// coalesces to `[]`.  The update is a merge patch (RS-47): an omitted
// collection there keeps the stored one, never `[]`.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const SRC = `
  system R {
    api RA from S
    subdomain S { context C {
      aggregate Prod { name: string }
      repository Prods for Prod { }
      valueobject Cond { k: string }
      aggregate Prov with crudish {
        name: string
        options: string[]
        products: Prod id[]
        conds: Cond[]
        maybe: string[]?
        nums: int[] = [1]
      }
      repository Provs for Prov { }
    } }
    storage pg { type: postgres }
    resource st { for: C, kind: state, use: pg }
    deployable api { platform: dotnet contexts: [C] dataSources: [st] serves: RA port: 5000 }
  }`;

describe("dotnet create request — omitted collections", () => {
  it("makes non-nullable collections optional on create and coalesces them to []", async () => {
    const files = await generateSystemFiles(SRC);
    const req = files.get("api/Application/Provs/Requests/ProvRequests.cs")!;
    const create = req.split("\n").find((l) => l.includes("record CreateProvRequest"))!;

    expect(create).toContain("IReadOnlyList<string>? Options = null");
    expect(create).toContain("IReadOnlyList<Guid>? Products = null");
    expect(create).toContain("IReadOnlyList<CondRequest>? Conds = null");
    expect(create).not.toMatch(/\[Required\][^,]*IReadOnlyList/);
    // A declared default keeps its own value; a nullable collection is untouched.
    const ctl = files.get("api/Api/ProvsController.cs")!;
    expect(ctl).toContain("request.Options is null ? [] : request.Options");
    expect(ctl).toContain("request.Products is null ? [] : request.Products");
    expect(ctl).toContain("request.Conds is null ? [] : request.Conds");
    expect(ctl).toContain("request.Nums is null ? [1] : request.Nums");
    expect(ctl).not.toContain("request.Maybe is null ? []");
    // The merge-patch update takes the collection as an optional key, and the
    // handler keeps the stored one when it is absent.
    expect(req).toContain("public IReadOnlyList<string>? Options { get => _options;");
    expect(files.get("api/Application/Provs/Commands/UpdateHandler.cs")).toContain(
      '(command.PatchedKeys.Contains("options") ? command.Options : aggregate.Options)',
    );
  });
});

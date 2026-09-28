// .NET lifecycle stamping — the EF Core AuditableInterceptor (audit-and-logging.md).
//
// Stamps (`stamp onCreate`/`onUpdate`) are applied by a SaveChangesInterceptor
// before persistence.  Timestamp values (`createdAt := now()`) render as
// `DateTime.UtcNow`; a PRINCIPAL value (`createdBy := currentUser`) resolves to
// the request principal's id read from the ambient RequestContext — the .NET
// analogue of the Java backend's `currentUser.id()`.  Post capability-stamp-
// dedup the interceptor keeps its per-aggregate switch (compile-bound writes)
// but writes columns through EF's metadata accessor via the COMPILE-CHECKED
// lambda (`ctx.Entry(e).Property(x => x.CreatedAt).CurrentValue = …`), so the
// stamped entity fields stay `{ get; private set; }` (no `internal set` leak)
// with no marker interface and no string-keyed property lookup.  Compiled
// end-to-end by the LOOM_DOTNET_BUILD `stamps-principal.ddd` cell; this suite
// pins the emitted constructs in the fast suite.

import { NodeFileSystem } from "langium/node";
import { parseHelper } from "langium/test";
import { describe, expect, it } from "vitest";
import { validateLoomModel } from "../../../src/ir/validate/validate.js";
import { createDddServices } from "../../../src/language/ddd-module.js";
import type { Model } from "../../../src/language/generated/ast.js";
import { generateSystems } from "../../../src/system/index.js";
import { buildLoomModel } from "../../_helpers/ir.js";

async function build(source: string): Promise<Model> {
  const services = createDddServices(NodeFileSystem);
  const helper = parseHelper(services.Ddd);
  const doc = await helper(source, { validation: true });
  const diagErrs = (doc.diagnostics ?? []).filter((d) => d.severity === 1);
  if (diagErrs.length) {
    throw new Error(
      `diagnostics:\n${diagErrs
        .map((e) => `${e.range.start.line + 1}:${e.range.start.character + 1} ${e.message}`)
        .join("\n")}`,
    );
  }
  return doc.parseResult?.value as Model;
}

const SOURCE = `
system PS {
  user { id: guid  name: string }
  subdomain D {
    context Shop {
      stamp onCreate { createdAt := now()  createdBy := currentUser }
      stamp onUpdate { updatedAt := now() }
      aggregate Order with crudish {
        code: string
        createdAt: datetime
        updatedAt: datetime
        createdBy: guid
      }
      repository Orders for Order { }
    }
  }
  api A from D
  storage primary { type: postgres }
  resource st { for: Shop, kind: state, use: primary }
  deployable api { platform: dotnet, contexts: [Shop], dataSources: [st], serves: A, port: 8081, auth: required }
}
`;

describe(".NET lifecycle stamping (AuditableInterceptor)", () => {
  it("keeps stamped entity fields `private set` (no marker, no `internal set` leak)", async () => {
    const files = generateSystems(await build(SOURCE)).files;
    // No marker interface is emitted — the concrete switch needs none.
    expect(files.has("api/Domain/Common/IAuditable.cs")).toBe(false);
    const entity = files.get("api/Domain/Orders/Order.cs")!;
    expect(entity).not.toMatch(/IAuditable/);
    // Stamped fields are `private set` — EF writes them via metadata.
    expect(entity).toMatch(/public DateTime CreatedAt \{ get; private set; \}/);
    expect(entity).toMatch(/public DateTime UpdatedAt \{ get; private set; \}/);
    expect(entity).toMatch(/public Guid CreatedBy \{ get; private set; \}/);
    expect(entity).not.toMatch(/CreatedAt \{ get; internal set; \}/);
    // A non-stamped field keeps its private setter too.
    expect(entity).toMatch(/public string Code \{ get; private set; \}/);
  });

  it("gates a currentUser stamp on a dotnet deployable WITHOUT auth fail-fast", async () => {
    const noAuth = SOURCE.replace(
      ", serves: A, port: 8081, auth: required }",
      ", serves: A, port: 8081 }",
    );
    const loom = await buildLoomModel(noAuth);
    const errors = validateLoomModel(loom).filter(
      (d) => d.code === "loom.stamp-principal-without-auth",
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.message).toContain("no auth");
  });
});

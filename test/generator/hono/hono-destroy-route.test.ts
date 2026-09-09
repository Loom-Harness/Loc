import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

// ---------------------------------------------------------------------------
// Hono canonical-destroy consumption.
//
// The Hono backend emits a `DELETE /{id}` route + a repo `delete(id)` method
// ONLY when the aggregate has a canonical (unnamed) destroy in the IR —
// declared, or contributed by the `crudish` macro.  Aggregates without one
// keep their existing route/repo files byte-for-byte (no DELETE), so this is
// purely additive.  See routes-builder.ts + repository-builder.ts.
// ---------------------------------------------------------------------------

const FIXTURE = `system AcmeDel {
  subdomain Ops {
    context Ops {
      // crudish injects a canonical create + destroy + update.
      aggregate Widget with crudish {
        label: string
        size: int
      }
      // Plain aggregate — no lifecycle actions, so no DELETE route.
      aggregate Gadget {
        name: string
      }
      repository Widgets for Widget { }
      repository Gadgets for Gadget { }
    }
  }
  api OpsApi from Ops
  storage pg { type: postgres }
  resource opsState { for: Ops, kind: state, use: pg }
  deployable opsApi {
    platform: node
    contexts: [Ops]
    dataSources: [opsState]
    serves: OpsApi
    port: 3000
  }
}
`;

async function build() {
  return await generateSystemFiles(FIXTURE);
}

function find(files: Map<string, string>, re: RegExp): string {
  for (const [k, v] of files) if (re.test(k)) return v;
  throw new Error(`no file matched ${re}`);
}

describe("Hono canonical-destroy → DELETE route", () => {
  it("emits a DELETE /{id} route for the crudish (lifecycle-bearing) aggregate", async () => {
    const files = await build();
    const routes = find(files, /widget\.routes\.ts$/);
    expect(routes).toContain('method: "delete"');
    expect(routes).toContain('path: "/{id}"');
    // Canonical operationId token → camelId(["destroy","Widget"]).
    expect(routes).toContain('operationId: "destroyWidget"');
    // 404 guard then hard delete.
    expect(routes).toContain("await repo.getById(Ids.WidgetId(id));");
    expect(routes).toContain("await repo.delete(Ids.WidgetId(id));");
    expect(routes).toContain("return c.body(null, 204);");
    // Still-referenced → 409 mapped locally.  The SQLSTATE is
    // `restrict_violation` (23001), not `foreign_key_violation` (23503): the FK
    // is emitted `ON DELETE RESTRICT`, and a RESTRICT check raises its own code.
    // This assertion used to pin 23503 alone, which is exactly the arm that
    // never fired — measured as a 500 against the declared 409 on a booted app
    // (F16).  23503 stays in the set for a NO ACTION FK.
    expect(routes).toContain('status: 409, detail: "Widget is still referenced');
    expect(routes).toContain(
      '["23001", "23503"].includes(((err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code) as string)',
    );
  });

  it("emits an `async delete(id)` method on the crudish aggregate's repository", async () => {
    const files = await build();
    const repo = find(files, /widget-repository\.ts$/i);
    expect(repo).toContain("async delete(id: Ids.WidgetId): Promise<void>");
    expect(repo).toContain("this.db.delete(schema.widgets).where(eq(schema.widgets.id, id))");
  });

  it("does NOT emit a DELETE route or delete() for a plain aggregate (gating)", async () => {
    const files = await build();
    const routes = find(files, /gadget\.routes\.ts$/);
    expect(routes).not.toContain('method: "delete"');
    expect(routes).not.toContain("repo.delete(");
    const repo = find(files, /gadget-repository\.ts$/i);
    expect(repo).not.toContain("async delete(");
  });
});

// ---------------------------------------------------------------------------
// F2-W-07 — java publishes the paged list read's envelope under the same name
// as the other four backends: the concrete record `<Agg>Paged`.
//
// springdoc names a generic component by flattening it, so a controller that
// returned the raw `Paged<WidgetResponse>` would publish `PagedWidgetResponse`.
// Every sibling backend publishes `WidgetPaged` for the same route: node
// `.openapi("WidgetPaged")`, python `response_model=WidgetPaged`, elixir's
// `WidgetPaged` OpenApiSpex schema, .NET's `CustomSchemaIds` mapping of
// `Paged<T>` → `<Agg>Paged`.  A client generated against a java spec naming
// anything else gets a type no other backend names.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const paged = (): string => `
system PG {
  subdomain S {
    context C {
      enum Grade { A, B }
      aggregate Widget with crudish {
        grade: Grade
      }
      repository Widgets for Widget
    }
  }
  api A from S
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable dj { platform: java, contexts: [C], dataSources: [st], serves: A, port: 4000 }
}`;

async function file(source: string, suffix: string): Promise<string> {
  const files = await generateSystemFiles(source);
  const hit = [...files.entries()].find(([p]) => p.endsWith(suffix));
  if (!hit) throw new Error(`no ${suffix}; got:\n${[...files.keys()].sort().join("\n")}`);
  return hit[1];
}

describe("java paged envelope naming (F2-W-07)", () => {
  it("the paged list read returns the concrete `<Agg>Paged`, not the raw generic", async () => {
    const controller = await file(paged(), "features/widgets/WidgetsController.java");
    expect(controller).toContain("public WidgetPaged allWidget(");
    // The raw generic is what springdoc flattened to `PagedWidgetResponse`.
    expect(controller).not.toContain("Paged<WidgetResponse>");
  });

  it("wraps the service's `Paged<T>` at the controller, so the service is unchanged", async () => {
    const controller = await file(paged(), "features/widgets/WidgetsController.java");
    expect(controller).toContain("var result = service.allWidget(page, pageSize, sort, dir);");
    expect(controller).toContain(
      "return new WidgetPaged(result.items(), result.page(), result.pageSize(), " +
        "result.total(), result.totalPages());",
    );
  });

  it("registers the `<Agg>Paged` required set on the OpenAPI customizer", async () => {
    const customizer = await file(paged(), "config/OpenApiContractCustomizer.java");
    expect(customizer).toContain("WidgetPaged");
    expect(customizer).not.toContain("PagedWidgetResponse");
  });
});

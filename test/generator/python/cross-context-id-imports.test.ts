// A python route module must IMPORT every id brand it constructs.
//
// The id-import candidate pool was `ctx.aggregates` (this bounded context) plus
// the NON-hosted foreign brands.  An `X id` field pointing at an aggregate in
// ANOTHER CONTEXT of the SAME deployable is in neither, so
//
//     created = Thing.create(title=body.title, owner=OwnerId(body.owner))
//
// was emitted against a name the module never imported.  Two consequences, and
// the second is why this outranks a normal type error:
//
//   * `mypy` — which `pyproject.toml` declares as this project's own gate —
//     reports `Name "OwnerId" is not defined`;
//   * at RUNTIME the module imports fine, because the reference only evaluates
//     inside the handler.  The failure is a `NameError` 500 on the first create
//     request, not at boot.
//
// Cross-context references are the normal shape of a multi-context system, so
// this fired on any model with more than one context in a deployable.
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const SYSTEM = `
  system P {
    subdomain S {
      context Owners {
        aggregate Owner {
          name: string
          derived display: string = name
        }
        repository Owners for Owner { }
      }
      context Things {
        aggregate Thing with crudish {
          title: string
          owner: Owner id
        }
        repository Things for Thing { }
      }
    }
    storage primary { type: postgres }
    resource o { for: Owners, kind: state, use: primary }
    resource t { for: Things, kind: state, use: primary }
    deployable api {
      platform: python
      contexts: [Owners, Things]
      dataSources: [o, t]
      port: 8000
    }
  }
`;

describe("python — a cross-context id brand is imported where it is constructed", () => {
  it("imports the sibling context's brand into the route module that wraps it", async () => {
    const files = await generateSystemFiles(SYSTEM);
    const routes = files.get("api/app/http/thing_routes.py");
    expect(routes, "thing_routes.py was emitted").toBeDefined();
    const src = routes ?? "";
    // It CONSTRUCTS the foreign brand …
    expect(src).toContain("OwnerId(body.owner)");
    // … so it must import it.  This is the assertion that fails without the fix.
    const importLine = src.split("\n").find((l) => l.startsWith("from app.domain.ids import"));
    expect(importLine, "the module imports its id brands").toBeDefined();
    expect(importLine).toContain("OwnerId");
    expect(importLine).toContain("ThingId");
  });

  it("still brands the sibling aggregate's id in ids.py", async () => {
    const files = await generateSystemFiles(SYSTEM);
    const ids = files.get("api/app/domain/ids.py") ?? "";
    expect(ids).toContain("OwnerId");
  });
});

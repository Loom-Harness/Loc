// `policy { allow local … }` / `deny` on a `shape: document` aggregate — the
// IN-APP authorization filter (pairwise finding F1).
//
// The `authz-filter` node is a SENTINEL each backend's QUERY-filter translator
// intercepts (Drizzle operator tree / JPQL / SQLAlchemy / EF).  A document
// aggregate has no query to translate into — the whole tree is one opaque jsonb
// column, so node/java/python filter document reads IN-APP over the rehydrated
// instance.  Reaching the GENERIC expression dispatcher there throws its
// internal invariant ("must be handled by the backend's query-filter
// translator"), so `desugarAuthzFilterInApp` lowers the sentinel to ordinary IR
// once and the three in-app sites render it through their existing expression
// renderer.  This file pins, per backend, that:
//
//   1. it generates at all (the crash regression);
//   2. the rendered predicate is the flat tenant floor — the row's `tenantId`
//      against the caller's claim (visibility is flat: D-TENANCY-FLAT);
//   3. `deny` becomes the always-false in-app conjunct;
//   4. Java compares the two STRING sides with `Objects.equals`, not `==`.
//      Java `==` on String is REFERENCE equality: it compiles green and is
//      silently wrong at runtime (two equal ids from different rows would not
//      match), which is exactly the failure mode a compile gate cannot see.
//
// Assertion (5) is the behavioural one: the emitted node predicate is EXECUTED
// against fabricated rows, so the floor is proven to FILTER — in-tenant rows
// visible, a foreign tenant and an unstamped row excluded — not merely to
// render.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

// `Thing` is tenant-owned + document-shaped under the `local` floor; `Note` is
// document-shaped and read-DENIED.  `Org` is the tenant registry.
const system = (platform: string) => `
  system DocPolicy {
    user { id: guid  role: string  tenantId: string }
    tenancy by user.tenantId of Org
    subdomain S {
      context C {
        aggregate Thing shape: document, with crudish, tenantOwned {
          label: string
          amount: int = 0
        }
        aggregate Note shape: document, with crudish, tenantOwned {
          body: string
        }
        repository Things for Thing
        criterion Labelled(l: string) of Thing = this.label == l
        queryHandler GetLabelled(l: string): Thing {
          if let t = Things.find(Labelled(l)) { return t } else { notFound }
        }
        repository Notes for Note
        policy {
          allow local on Thing
          deny on Note
        }
      }
      context R {
        aggregate Org with crudish {
          name: string
          implements tenantRegistry
        }
        repository Orgs for Org
      }
    }
    api DocApi from S { route GET "/things/labelled" -> C.GetLabelled }
    storage primarySql { type: postgres }
    resource cState { for: C, kind: state, use: primarySql }
    resource rState { for: R, kind: state, use: primarySql }
    deployable api {
      platform: ${platform}
      contexts: [C, R]
      dataSources: [cState, rState]
      serves: DocApi
      port: 3001
      auth: required
    }
  }
`;

async function fileContaining(platform: string, needle: string): Promise<string> {
  const files = await generateSystemFiles(system(platform));
  for (const [p, body] of files) if (p.includes(needle)) return body;
  return "";
}

describe("policy × shape: document — node (Hono/Drizzle)", () => {
  it("renders the local ladder as the in-app tenant floor", async () => {
    const thing = await fileContaining("node", "thing-repository");
    expect(thing).toContain("if (!((rec.tenantId === currentUser.operatingOrg))) return null;");
    // The principal is bound fail-closed from the ambient accessor.
    expect(thing).toContain("const currentUser = requireCurrentUser();");
    // Visibility is flat: no org path is read (D-TENANCY-FLAT).
    expect(thing).not.toContain("dataKey");
  });

  // A criterion read over a `shape: document` aggregate
  // (`Things.find(Labelled(l))`) calls `things.runFindAllByLabelled(…)`, which
  // filters in-app under the same ladder as the by-id reads, as java's does.
  it("the same predicate narrows a criterion read, not just findById", async () => {
    const thing = await fileContaining("node", "thing-repository");
    const method = thing.slice(thing.indexOf("async runFindAllByLabelled("));
    expect(method).toContain("async runFindAllByLabelled(");
    expect(method).toContain("x.label === l");
  });

  it("renders deny as the always-false in-app conjunct", async () => {
    const note = await fileContaining("node", "note-repository");
    // Deny is AND-ed beside the tenant floor, so the aggregate is invisible.
    expect(note).toContain("if (!((rec.tenantId === currentUser.operatingOrg) && (false)))");
    expect(note).toContain(
      "all.filter((x) => (x.tenantId === currentUser.operatingOrg) && (false))",
    );
  });

  // ---- (5) the floor actually FILTERS ------------------------------------
  // Execute the emitted predicate over fabricated rows: the caller's own
  // tenant is visible; a foreign tenant and an unstamped (empty-tenant) row
  // are not.
  it("admits the caller's tenant and excludes everything else (executed)", async () => {
    const thing = await fileContaining("node", "thing-repository");
    const line = thing
      .split("\n")
      .find((l) => l.includes("const result = all.filter((x) =>") && l.includes("tenantId"));
    expect(line, "the findAll in-app filter should be emitted").toBeTruthy();
    const body = line!.slice(line!.indexOf("all.filter((x) =>") + "all.filter((x) =>".length);
    // Take the predicate up to the closing paren of the `.filter(` call.
    const pred = body.slice(0, body.lastIndexOf(");"));
    const visible = new Function("all", "currentUser", `return all.filter((x) => ${pred});`) as (
      all: { id: string; tenantId: string }[],
      currentUser: { operatingOrg: string },
    ) => { id: string; tenantId: string }[];

    const rows = [
      { id: "own", tenantId: "t1" }, // the caller's own tenant
      { id: "foreign", tenantId: "t2" }, // another tenant — hidden
      { id: "unstamped", tenantId: "" }, // a row written without a stamp — hidden
    ];
    const got = visible(rows, { operatingOrg: "t1" }).map((r) => r.id);
    expect(got).toEqual(["own"]);
  });
});

describe("policy × shape: document — python (FastAPI/SQLAlchemy)", () => {
  it("renders the local ladder as the in-app tenant floor", async () => {
    const thing = await fileContaining("python", "thing_repository");
    expect(thing).toContain("if not ((rec.tenant_id == current_user.operating_org)):");
    expect(thing).toContain("current_user = require_current_user()");
  });

  it("renders deny as the always-false in-app conjunct", async () => {
    expect(await fileContaining("python", "note_repository")).toContain(
      "if not ((rec.tenant_id == current_user.operating_org) and (False)):",
    );
  });
});

describe("policy × shape: document — java (Spring Boot)", () => {
  it("renders the local ladder as the in-app tenant floor", async () => {
    const thing = await fileContaining("java", "ThingRepositoryImpl");
    expect(thing).toContain(
      "return (currentUser != null && (Objects.equals(rec.tenantId(), currentUser.operatingOrg()))) ? Optional.of(rec) : Optional.empty();",
    );
    // `java.util.Objects` must actually be imported, or this does not compile.
    expect(thing).toContain("import java.util.Objects;");
  });

  it("compares the string sides with Objects.equals, never Java reference ==", async () => {
    const thing = await fileContaining("java", "ThingRepositoryImpl");
    // The regression this pins: `leftType`-less binary nodes render `==`, which
    // on String is reference equality — green under `gradle testClasses` and
    // silently wrong at runtime.
    expect(thing).not.toContain("rec.tenantId() == currentUser.operatingOrg()");
  });

  it("renders deny as the always-false in-app conjunct", async () => {
    expect(await fileContaining("java", "NoteRepositoryImpl")).toContain("(false)");
  });

  it("a criterion read filters the floor-scoped rows in-app", async () => {
    const thing = await fileContaining("java", "ThingRepositoryImpl");
    expect(thing).toContain(
      "return findAll().stream().filter(x -> Objects.equals(x.label(), l)).toList();",
    );
  });
});

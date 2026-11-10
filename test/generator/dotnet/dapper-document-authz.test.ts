// `persistence: dapper` + `shape: document` + a `policy { … }` ladder.
//
// A document aggregate is ONE opaque jsonb column, so the capability filter's
// fields (`tenantId`, `isDeleted`) have no column a WHERE fragment could name —
// the predicate has to run IN-APP over the rehydrated instance, exactly as the
// EF document repository (`renderDocumentRepositoryImpl`) and node/java/python
// do.  The Dapper twin therefore carries both halves:
//
//   1. `_CapabilityVisible` on every read path — without it a `tenantOwned`
//      document aggregate reads UNFILTERED across tenants under this adapter,
//      silently: it compiles, and `validateContextFilterSupport` claims .NET
//      filters every shape.
//   2. `GetByIdForWriteAsync` — the Domain interface declares it whenever the
//      aggregate carries a `writeScopeFilter` (`deny write`), so without it
//      the project fails CS0535.
//
// The compile halves are gated end-to-end by `corpus-dotnet-dapper-build`
// (`policy-document`); this suite is the fast structural pin, and the ONLY
// gate on the silent read-filter half.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

/** Document-shaped, tenant-owned aggregates under a `deny write` and a `deny`
 *  ladder, plus the tenant registry — the shape of
 *  `test/fixtures/corpus/policy-document.ddd`. */
const SRC = `
  system S {
    user { id: guid  role: string  tenantId: string }
    tenancy by user.tenantId of Org
    subdomain D {
      context C {
        aggregate Thing shape: document, with crudish, tenantOwned {
          label: string
        }
        aggregate Note shape: document, with crudish, tenantOwned {
          body: string
        }
        repository Things for Thing
        repository Notes for Note
        policy {
          deny write on Thing
          deny on Note
        }
      }
      context R {
        aggregate Org with crudish { name: string  implements tenantRegistry }
        repository Orgs for Org
      }
    }
    api MainApi from D
    storage primary { type: postgres }
    resource mainState { for: C, kind: state, use: primary }
    resource regState { for: R, kind: state, use: primary }
    deployable api {
      platform: dotnet { persistence: dapper }
      contexts: [C, R]
      dataSources: [mainState, regState]
      serves: MainApi
      port: 3000
      auth: required
    }
  }
`;

let cache: Map<string, string> | undefined;
async function files(): Promise<Map<string, string>> {
  cache ??= await generateSystemFiles(SRC);
  return cache;
}

async function file(suffix: string): Promise<string> {
  const all = await files();
  const key = [...all.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return all.get(key!)!;
}

// Visibility is flat (D-TENANCY-FLAT): no request resolves an org path, so
// neither the EF nor the Dapper resolver is emitted or registered.
describe("no org-path resolver is emitted", () => {
  it("emits no resolver file and registers none", async () => {
    const all = await files();
    expect([...all.keys()].filter((p) => /OrgPathResolver/.test(p))).toEqual([]);
    expect(await file("Program.cs")).not.toContain("IOrgPathResolver");
  });
});

describe("the Dapper document repository carries the authorization ladder", () => {
  it("implements the write-scope port member the `deny write` ladder declares", async () => {
    const iface = await file("Domain/Things/IThingRepository.cs");
    expect(iface, "precondition: the ladder puts GetByIdForWriteAsync on the port").toContain(
      "GetByIdForWriteAsync",
    );
    const repo = await file("Infrastructure/Repositories/ThingRepository.cs");
    expect(repo, "CS0535 without it").toContain(
      "public async Task<Thing?> GetByIdForWriteAsync(ThingId id, CancellationToken cancellationToken = default)",
    );
    // A method body, so the always-false scope never makes a statement
    // unreachable (CS0162 under /warnaserror).
    expect(repo).toContain("private static bool _WriteScopeAllows(Thing x) => false;");
  });

  it("applies the capability read filter on EVERY read path", async () => {
    const repo = await file("Infrastructure/Repositories/ThingRepository.cs");
    // The tenant floor, executed in-app.
    expect(repo).toContain(
      "private static bool _CapabilityVisible(Thing x) => (x.TenantId == RequestContext.Current!.CurrentUser!.OperatingOrg);",
    );
    // GetByIdAsync — an out-of-scope row reads as missing (→ 404), matching
    // what the relational adapter's spliced WHERE does to the same lookup.
    expect(repo).toContain("return _CapabilityVisible(__rec) ? __rec : null;");
    // FindManyByIdsAsync and the collection read fold through `.Where(...)`.
    const methodOf = (name: string): string => {
      const start = repo.indexOf(` ${name}(`);
      expect(start, `no ${name} in ThingRepository.cs`).toBeGreaterThan(-1);
      return repo.slice(start, repo.indexOf("\n    }", start));
    };
    for (const name of ["FindManyByIdsAsync", "All"]) {
      expect(methodOf(name), `${name} must narrow to the visible set`).toContain(
        ".Where(_CapabilityVisible)",
      );
    }
  });

  it("a `deny` ladder renders as a method body, never an inlined constant", async () => {
    const repo = await file("Infrastructure/Repositories/NoteRepository.cs");
    // Inlined, `false` would make the following statement unreachable — CS0162,
    // an error under /warnaserror.  As a method body it is clean.
    expect(repo).toContain("private static bool _CapabilityVisible(Note x) =>");
    expect(repo).toContain("(false)");
    expect(repo).not.toContain("if (!(false))");
  });
});

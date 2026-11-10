// A `shape: document` aggregate on the .NET backend gets NO EF
// `HasQueryFilter` — its persistence record is `(Id, Data jsonb, Version)`, so
// the filtered fields (`tenantId`, `isDeleted`) live INSIDE the blob and there
// is no mapped column for EF to attach a predicate to.  Without another seam a
// `tenantOwned` document aggregate would read UNFILTERED across tenants while
// `validateContextFilterSupport` claims .NET filters every shape — a SILENT
// cross-tenant read, not a crash.
//
// So, as on node/java/python, the capability predicate is applied IN-APP over
// the rehydrated aggregate, at every read seam.  These pins assert three
// separable things, because each can fail independently:
//
//   1. the document path FILTERS at every read seam (findById /
//      findManyByIds / the collection read `All`),
//   2. the RELATIONAL twin still filters through EF `HasQueryFilter` — the
//      relational path is not migrated to in-app filtering,
//   3. a document aggregate with NO capability filter emits NO predicate
//      (the unchanged-emission floor).
//
// Plus the trap a real `dotnet build /warnaserror` catches and a string-level
// pin would not: `policy { deny write … }` × document needs the document
// repository to implement `GetByIdForWriteAsync`, which the interface
// declares, or the build fails CS0535.
//
// The `dotnet build /warnaserror` gate over the same crossings lives in
// test/e2e/generated-dotnet-build.test.ts (fixture:
// test/e2e/fixtures/dotnet-build/document-tenancy.ddd).

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

/** `Note` is the DOCUMENT twin, `Ledger` the RELATIONAL control — identical
 *  capability, so whatever filters one must filter the other. */
const tenantSystem = `
  system TenantDoc {
    user { id: guid  tenantId: string }
    tenancy by user.tenantId of Org
    subdomain S {
      context C {
        aggregate Note shape: document, with tenantOwned {
          title: string
        }
        aggregate Ledger with tenantOwned {
          label: string
        }
        aggregate Org {
          name: string
          implements tenantRegistry
        }
        repository Notes for Note { }
        repository Ledgers for Ledger { }
        repository Orgs for Org { }
      }
    }
    api DocApi from S
    storage primarySql { type: postgres }
    resource docState { for: C, kind: state, use: primarySql }
    deployable api {
      platform: dotnet
      contexts: [C]
      dataSources: [docState]
      serves: DocApi
      port: 3001
      auth: required
    }
  }
`;

/** No capability at all — the unchanged-emission floor. */
const plainSystem = `
  system PlainDoc {
    subdomain S {
      context C {
        aggregate Note shape: document {
          title: string
        }
        repository Notes for Note { }
      }
    }
    api DocApi from S
    storage primarySql { type: postgres }
    resource docState { for: C, kind: state, use: primarySql }
    deployable api {
      platform: dotnet
      contexts: [C]
      dataSources: [docState]
      serves: DocApi
      port: 3001
    }
  }
`;

/** A `deny write` ladder, so the aggregate carries a `writeScopeFilter`
 *  narrower than its read floor (which is what makes `GetByIdForWriteAsync`
 *  exist). */
const policySystem = `
  system PolicyDoc {
    user { id: guid  tenantId: string }
    tenancy by user.tenantId of Org
    subdomain S {
      context C {
        policy {
          deny write on Note
          deny write on Ledger
        }
        aggregate Note shape: document, with tenantOwned, crudish {
          title: string
        }
        aggregate Ledger with tenantOwned, crudish {
          label: string
        }
        aggregate Org with crudish {
          name: string
          implements tenantRegistry
        }
        repository Notes for Note { }
        repository Ledgers for Ledger { }
        repository Orgs for Org { }
      }
    }
    api DocApi from S
    storage primarySql { type: postgres }
    resource docState { for: C, kind: state, use: primarySql }
    deployable api {
      platform: dotnet
      contexts: [C]
      dataSources: [docState]
      serves: DocApi
      port: 3001
      auth: required
    }
  }
`;

/** The one emitted file whose basename matches — asserting against the WHOLE
 *  joined output would let a pin pass on a hit in a sibling aggregate's file,
 *  which is exactly the confusion this bug lived in. */
async function fileNamed(source: string, basename: string): Promise<string> {
  const files = await generateSystemFiles(source);
  const hit = [...files.entries()].find(([p]) => p.endsWith(`/${basename}`));
  if (!hit) {
    throw new Error(
      `no emitted file named ${basename}; got:\n${[...files.keys()].slice(0, 40).join("\n")}`,
    );
  }
  return hit[1];
}

describe("dotnet: shape: document × tenantOwned — the in-app tenant read filter", () => {
  it("gates findById on the capability predicate (a foreign-tenant row reads as missing)", async () => {
    const repo = await fileNamed(tenantSystem, "NoteRepository.cs");
    // Rehydrate, then gate — an out-of-scope document must return null, which
    // is what EF's query filter does to the relational twin's FirstOrDefault.
    expect(repo).toContain("return _CapabilityVisible(__rec) ? __rec : null;");
  });

  it("filters findManyByIds and the collection read", async () => {
    const repo = await fileNamed(tenantSystem, "NoteRepository.cs");
    // findManyByIds.
    expect(repo).toContain(".Where(_CapabilityVisible).ToList();");
    // TWO multi-row seams narrow the rehydrated set: findManyByIds and the
    // collection read `All`.  Counted rather than merely `toContain`-ed: the
    // original bug was one seam filtered and another silently not, which a
    // substring pin cannot tell apart.
    const narrowed = repo.match(
      /\.Select\(__d => Note\.FromSnapshot\([^\n]*?\)\.Where\(_CapabilityVisible\)/g,
    );
    expect(narrowed?.length, "findManyByIds + All each narrow to the visible set").toBe(2);
  });

  it("resolves the principal through the ambient accessor, re-read per call", async () => {
    const repo = await fileNamed(tenantSystem, "NoteRepository.cs");
    expect(repo).toContain(
      "private static bool _CapabilityVisible(Note x) => (x.TenantId == RequestContext.Current!.CurrentUser!.TenantId);",
    );
  });

  it("leaves the RELATIONAL twin on EF HasQueryFilter (the fix did not migrate it)", async () => {
    const ctx = await fileNamed(tenantSystem, "AppDbContext.cs");
    expect(ctx).toContain(
      'modelBuilder.Entity<Ledger>().HasQueryFilter("TenantIdFilter", x => x.TenantId == _currentUser.User.TenantId);',
    );
    // The document aggregate is NOT given a query filter — it cannot have one
    // (its columns are inside the blob); the in-app predicate above is its
    // whole enforcement, and this pins that the two paths stay distinct.
    expect(ctx).not.toContain("Entity<Note>().HasQueryFilter");
    const repo = await fileNamed(tenantSystem, "LedgerRepository.cs");
    expect(repo).not.toContain("_CapabilityVisible");
  });

  it("emits NO predicate when the document aggregate carries no capability filter", async () => {
    const repo = await fileNamed(plainSystem, "NoteRepository.cs");
    expect(repo).not.toContain("_CapabilityVisible");
    // The unchanged emission returns the rehydrated document directly.
    expect(repo).toContain("return Note.FromSnapshot(");
  });
});

describe("dotnet: shape: document × policy — the write-scope seam", () => {
  it("implements GetByIdForWriteAsync on the document repository (CS0535 without it)", async () => {
    const iface = await fileNamed(policySystem, "INoteRepository.cs");
    const repo = await fileNamed(policySystem, "NoteRepository.cs");
    // The interface declares it whenever the write scope is narrower than the
    // read scope; a document impl without it fails CS0535.
    expect(iface).toContain("Task<Note?> GetByIdForWriteAsync(");
    expect(repo).toContain("public async Task<Note?> GetByIdForWriteAsync(");
    // Loads through GetByIdAsync (which already applies the READ filter, the
    // way EF applies the query filter to the relational `Any`), then narrows
    // to the write scope — write scope ∩ read scope, same as relational.
    expect(repo).toContain("var __found = await GetByIdAsync(id, cancellationToken);");
    expect(repo).toContain("return _WriteScopeAllows(__found) ? __found : null;");
  });
});

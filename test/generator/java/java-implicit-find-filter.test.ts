// A clause-less find is a key lookup, not a scan: `find byReference(reference:
// string): WorkOrder?` answers only the rows whose `reference` equals the
// argument.  Java must filter by that implicit key match on every persistence
// shape — a JPA `@Query` with no `where` returns some other row with a 200 on a
// miss (and a non-unique 500 once two rows exist), validating clean, compiling,
// and passing `gradle test` (https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/audits/2026-10-04-testability-reaudit.md, N2).
//
// The pairing rule is the one every backend shares (`implicitFindMatches`):
// same-named field, or the field whose `<field>Id` spelling the param is.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = `
system FieldOps {
  subdomain Ops {
    context Ops {
      aggregate Site with crudish { name: string }
      repository Sites for Site { }
      aggregate WorkOrder with crudish {
        reference: string
        region: string
        site: Site id
      }
      repository WorkOrders for WorkOrder {
        find byReference(reference: string): WorkOrder?
        find byRegionAndRef(region: string, reference: string): WorkOrder[]
        find bySite(siteId: Site id): WorkOrder[]
        find inRegion(region: string): WorkOrder paged
        find explicitRef(r: string): WorkOrder? where this.reference == r
      }
      aggregate Note shape: document {
        slug: string
        body: string
      }
      repository Notes for Note {
        find bySlug(slug: string): Note?
        find bodies(body: string): Note paged
      }
    }
    context Accounts {
      event Opened { account: Account id, owner: string }
      aggregate Account persistedAs: eventLog {
        owner: string
        create open(owner: string) { emit Opened { account: id, owner: owner } }
        apply(e: Opened) { owner := e.owner }
      }
      repository Accounts for Account {
        find byOwner(owner: string): Account?
      }
    }
  }
  api OpsApi from Ops
  storage pg { type: postgres }
  resource st { for: Ops, kind: state, use: pg }
  resource es { for: Accounts, kind: eventLog, use: pg }
  deployable app { platform: java, contexts: [Ops, Accounts], dataSources: [st, es], serves: OpsApi, port: 4000 }
}
`;

const FEATURES = "app/src/main/java/com/loom/app/features";

async function file(rel: string): Promise<string> {
  const files = await generateSystemFiles(SRC);
  const body = files.get(`${FEATURES}/${rel}`);
  expect(body, rel).toBeDefined();
  return body!;
}

describe("java — a clause-less find applies its implicit key-match filter (N2)", () => {
  it("JPA: single, multi-param, `<field>Id` and paged finds carry the where", async () => {
    const jpa = await file("workorders/WorkOrderJpaRepository.java");
    expect(jpa).toContain(
      `@Query("select e from WorkOrder e where e.reference = :reference")\n    WorkOrder byReference(`,
    );
    expect(jpa).toContain(
      `@Query("select e from WorkOrder e where e.region = :region and e.reference = :reference")\n    List<WorkOrder> byRegionAndRef(`,
    );
    expect(jpa).toContain(
      `@Query("select e from WorkOrder e where e.site = :siteId")\n    List<WorkOrder> bySite(`,
    );
    expect(jpa).toContain(
      `@Query("select e from WorkOrder e where e.region = :region")\n    Page<WorkOrder> inRegion(`,
    );
  });

  it("JPA: an explicit where is untouched", async () => {
    const jpa = await file("workorders/WorkOrderJpaRepository.java");
    expect(jpa).toContain(
      `@Query("select e from WorkOrder e where e.reference = :r")\n    WorkOrder explicitRef(`,
    );
  });

  it("document store: single and paged finds filter in-app", async () => {
    const impl = await file("notes/NoteRepositoryImpl.java");
    expect(impl).toContain(
      "findAll().stream().filter(x -> Objects.equals(x.slug(), slug)).findFirst().orElse(null);",
    );
    expect(impl).toContain(
      "var all = findAll().stream().filter(x -> Objects.equals(x.body(), body)).toList();",
    );
    expect(impl).toContain("import java.util.Objects;");
  });

  it("event store: the find filters the folded aggregates", async () => {
    const impl = await file("accounts/AccountRepositoryImpl.java");
    expect(impl).toContain(
      "findAll().stream().filter(x -> Objects.equals(x.owner(), owner)).findFirst().orElse(null);",
    );
    expect(impl).toContain("import java.util.Objects;");
  });
});

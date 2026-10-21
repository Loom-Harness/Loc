// ---------------------------------------------------------------------------
// .NET document store — a repository `find … ignoring <Cap>` / `ignoring *`
// narrows the in-app capability filter (C2, M-T6.75).
//
// A `shape: document` aggregate's capability filters are evaluated in-app
// over the rehydrated jsonb blob (`_CapabilityVisible`), not as an EF
// `HasQueryFilter`, so the relational `.IgnoreQueryFilters(…)` never reached
// them: every declared find — scoped, `ignoring tenantOwned`, `ignoring *` —
// got the same `.Where(_CapabilityVisible)` and a bypassing read was silently
// over-restricted.
//
// Every assertion is paired presence + ABSENCE: the failure mode is a
// RETAINED conjunct, which a presence-only assertion cannot see.  The root
// reads (by-id / `FindManyByIdsAsync`) carry no clause and must keep BOTH
// filters whatever a sibling find bypasses (the fail-OPEN direction).
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";
import { corpusSourceFor } from "../../fixtures/corpus/harness.js";

const SRC = corpusSourceFor("find-bypass", "dotnet");
const TENANT = "x.TenantId == ";
const DELETED = "!x.IsDeleted";

async function noteRepo(): Promise<string> {
  const files = await generateSystemFiles(SRC);
  const path = [...files.keys()].find((p) =>
    p.endsWith("Infrastructure/Repositories/NoteRepository.cs"),
  );
  if (!path) throw new Error("NoteRepository.cs not emitted");
  return files.get(path)!;
}

/** The body of one method in the repository impl, by method name. */
function bodyOf(impl: string, method: string): string {
  const start = impl.indexOf(` ${method}(`);
  if (start < 0) throw new Error(`no method ${method}`);
  const end = impl.indexOf("\n    }", start);
  return impl.slice(start, end);
}

describe(".NET document store — `find … ignoring` (C2, M-T6.75)", () => {
  it("the shared `_CapabilityVisible` still ANDs both filters", async () => {
    const impl = await noteRepo();
    const m = /private static bool _CapabilityVisible\(Note x\) => (.*);/.exec(impl);
    expect(m, "no _CapabilityVisible").not.toBeNull();
    expect(m![1]).toContain(TENANT);
    expect(m![1]).toContain(DELETED);
  });

  it("a find with NO clause keeps both filters", async () => {
    const body = bodyOf(await noteRepo(), "ScopedNote");
    expect(body).toContain(".Where(_CapabilityVisible)");
  });

  it("`ignoring tenantOwned` drops the tenant conjunct and keeps not-deleted", async () => {
    const body = bodyOf(await noteRepo(), "AnyTenantNote");
    expect(body).not.toContain("_CapabilityVisible");
    expect(body).not.toContain(TENANT);
    expect(body).toContain(DELETED);
  });

  it("`ignoring *` drops both conjuncts", async () => {
    const body = bodyOf(await noteRepo(), "UnfilteredNote");
    expect(body).not.toContain("_CapabilityVisible");
    expect(body).not.toContain(TENANT);
    expect(body).not.toContain(DELETED);
  });

  it("the root reads keep both filters whatever a find bypasses", async () => {
    const impl = await noteRepo();
    expect(bodyOf(impl, "GetByIdAsync")).toContain("_CapabilityVisible(__rec)");
    expect(bodyOf(impl, "FindManyByIdsAsync")).toContain(".Where(_CapabilityVisible)");
  });
});

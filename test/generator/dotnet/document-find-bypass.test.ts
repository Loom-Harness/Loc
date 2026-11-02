// ---------------------------------------------------------------------------
// .NET document store — the in-app capability filter on the root reads.
//
// A `shape: document` aggregate's capability filters are evaluated in-app
// over the rehydrated jsonb blob (`_CapabilityVisible`), not as an EF
// `HasQueryFilter`.  The root reads (by-id / `FindManyByIdsAsync`) carry no
// `ignoring` clause and must keep BOTH filters whatever a sibling read on the
// relational aggregate of the same fixture bypasses (the fail-OPEN direction).
// A document aggregate has no single-row criterion read on every backend, so
// the fixture carries no bypassing read over `Note`.
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

describe(".NET document store — the in-app capability filter", () => {
  it("the shared `_CapabilityVisible` still ANDs both filters", async () => {
    const impl = await noteRepo();
    const m = /private static bool _CapabilityVisible\(Note x\) => (.*);/.exec(impl);
    expect(m, "no _CapabilityVisible").not.toBeNull();
    expect(m![1]).toContain(TENANT);
    expect(m![1]).toContain(DELETED);
  });

  it("the root reads keep both filters", async () => {
    const impl = await noteRepo();
    expect(bodyOf(impl, "GetByIdAsync")).toContain("_CapabilityVisible(__rec)");
    expect(bodyOf(impl, "FindManyByIdsAsync")).toContain(".Where(_CapabilityVisible)");
  });
});

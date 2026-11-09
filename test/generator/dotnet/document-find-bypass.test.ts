// ---------------------------------------------------------------------------
// .NET document store — the in-app capability filter, on both persistence
// adapters (EF and Dapper).
//
// A `shape: document` aggregate's capability filters are evaluated in-app
// over the rehydrated jsonb blob (`_CapabilityVisible`), not as an EF
// `HasQueryFilter` / a SQL WHERE.  The root reads (by-id /
// `FindManyByIdsAsync`) carry no `ignoring` clause and must keep BOTH filters
// whatever a sibling read bypasses (the fail-OPEN direction).  A widened read
// (`Notes.find(NoteBody(b)) ignoring …`) keeps exactly the filters its clause
// does not name: `ignoring tenantOwned` keeps the not-deleted conjunct only,
// `ignoring *` keeps none.  Every assertion is paired presence + ABSENCE: the
// failure mode is a RETAINED conjunct, invisible to a presence-only check.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";
import { corpusSourceFor } from "../../fixtures/corpus/harness.js";

const TENANT = "x.TenantId == ";
const DELETED = "!x.IsDeleted";

async function noteRepo(persistence?: string): Promise<string> {
  const files = await generateSystemFiles(corpusSourceFor("find-bypass", "dotnet", persistence));
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

/** The `.Where(…)` filter on the method's `var __all = …` load ("" for none). */
function loadFilterOf(impl: string, method: string): string {
  const line = bodyOf(impl, method)
    .split("\n")
    .find((l) => l.includes("var __all = "));
  if (!line) throw new Error(`no __all load in ${method}`);
  const at = line.indexOf(".Where(");
  return at < 0 ? "" : line.slice(at);
}

for (const persistence of [undefined, "dapper"]) {
  const adapter = persistence ?? "ef";
  describe(`.NET document store (${adapter}) — the in-app capability filter`, () => {
    it("the shared `_CapabilityVisible` still ANDs both filters", async () => {
      const impl = await noteRepo(persistence);
      const m = /private static bool _CapabilityVisible\(Note x\) => (.*);/.exec(impl);
      expect(m, "no _CapabilityVisible").not.toBeNull();
      expect(m![1]).toContain(TENANT);
      expect(m![1]).toContain(DELETED);
    });

    it("the root reads keep both filters", async () => {
      const impl = await noteRepo(persistence);
      expect(bodyOf(impl, "GetByIdAsync")).toContain("_CapabilityVisible(");
      expect(bodyOf(impl, "FindManyByIdsAsync")).toContain(".Where(_CapabilityVisible)");
    });

    it("`ignoring tenantOwned` keeps the not-deleted conjunct and drops the tenant one", async () => {
      const impl = await noteRepo(persistence);
      const filter = loadFilterOf(impl, "FindFirstNoteBodyIgnoringTenantOwned");
      expect(filter).toContain(DELETED);
      expect(filter).not.toContain("_CapabilityVisible");
      expect(filter).not.toContain("TenantId");
    });

    it("`ignoring *` drops every filter", async () => {
      const impl = await noteRepo(persistence);
      const filter = loadFilterOf(impl, "FindFirstNoteBodyIgnoringAll");
      expect(filter).toBe("");
    });
  });
}

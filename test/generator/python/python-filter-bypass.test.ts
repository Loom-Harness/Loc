// ---------------------------------------------------------------------------
// `ignoring` filter-bypass on the Python/FastAPI+SQLAlchemy backend
// (named-filter-bypass.md §11).  Every read restriction rides the read-scope
// hook (`app/db/read_scope.py`); a read carrying `ignoring <Cap>` /
// `ignoring *` carries the `loom_ignoring` execution option naming what it
// drops, and the hook omits exactly the restrictions of that provenance for
// that read only.  A bare (capability-less) `filter` has no provenance and is
// NEVER bypassable.
//
// The phoenix analogue is test/generator/elixir/phoenix-filter-bypass.test.ts;
// the always-on emission is guarded by context-filter-emit.test.ts.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystems } from "../../../src/system/index.js";
import { parseString } from "../../_helpers/index.js";

const REPO = "api/app/db/repositories/doc_repository.py";
const SCOPE = "api/app/db/read_scope.py";

async function build(source: string): Promise<Map<string, string>> {
  const { model, errors } = await parseString(source);
  if (errors.length) throw new Error(`source has validation errors:\n${errors.join("\n")}`);
  return generateSystems(model).files;
}

/** The body of one repository method (`async def <name>(…):` up to the next
 *  `    async def`/`    def` or EOF). */
function method(repo: string, name: string): string {
  const lines = repo.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^ {4}(async )?def ${name}\\(`).test(l));
  expect(start, `method ${name} not emitted`).toBeGreaterThanOrEqual(0);
  const out = [lines[start]!];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {4}(async )?def /.test(lines[i]!)) break;
    out.push(lines[i]!);
  }
  return out.join("\n");
}

// softDeletable contributes an `is_deleted` capability filter; `recent`
// ignores it; `normal` does not; `allRows` ignores * (every capability filter).
// A bare `filter this.total > 0` (undefined origin) is NEVER bypassable.
function sys(repoBody: string, extraFilters = ""): string {
  return `
system Sys {
  capability softDeletable { isDeleted: bool  filter this.isDeleted == false }
  subdomain Sales {
    context Docs {
      aggregate Doc with softDeletable {
        subject: string
        total: int
        ${extraFilters}
      }
      repository Docs for Doc {
        ${repoBody}
      }
    }
  }
  api DocsApi from Sales
  storage primary { type: postgres }
  resource docsState { for: Docs, kind: state, use: primary }
  deployable api {
    platform: python
    contexts: [Docs]
    dataSources: [docsState]
    serves: DocsApi
    port: 8081
  }
}
`;
}

describe("python filter-bypass (ignoring <Cap> / *)", () => {
  it("a bypassing find names the capability it drops; a normal find names none", async () => {
    const repo = (
      await build(
        sys(`find recent(): Doc[] where this.subject != "" ignoring softDeletable
          find normal(): Doc[] where this.subject != ""`),
      )
    ).get(REPO)!;
    expect(repo).toBeDefined();
    const recent = method(repo, "recent");
    expect(recent).toContain('.execution_options(loom_ignoring=frozenset({"softDeletable"}))');
    expect(recent).toContain("DocRow.subject !=");
    expect(recent).not.toContain("is_deleted");
    expect(method(repo, "normal")).not.toContain("loom_ignoring");
  });

  it("`ignoring *` carries the wildcard", async () => {
    const repo = (
      await build(
        sys(`find allRows(): Doc[] ignoring *
          find normal(): Doc[] where this.subject != ""`),
      )
    ).get(REPO)!;
    expect(method(repo, "all_rows")).toContain(
      '.execution_options(loom_ignoring=frozenset({"*"}))',
    );
    expect(method(repo, "normal")).not.toContain("loom_ignoring");
  });

  it("the hook drops a capability restriction only when the read names it", async () => {
    const scope = (
      await build(sys(`find recent(): Doc[] where this.subject != "" ignoring softDeletable`))
    ).get(SCOPE)!;
    expect(scope).toContain('    return "*" in ignoring or capability in ignoring');
    expect(scope).toContain(
      '    if not _bypassed("softDeletable", ignoring):\n        out.append(with_loader_criteria(DocRow, lambda cls: (cls.is_deleted == False), include_aliases=True))',
    );
    expect(scope).toContain(
      'ignoring: Collection[str] = state.execution_options.get("loom_ignoring", frozenset())',
    );
  });

  it("a bare (non-capability) filter is NEVER dropped, even by `ignoring *`", async () => {
    const scope = (
      await build(sys(`find allRows(): Doc[] ignoring *`, `filter this.total > 0`))
    ).get(SCOPE)!;
    // Unconditional: no `_bypassed` guard precedes it.
    expect(scope).toContain(
      "    # filter\n    out.append(with_loader_criteria(DocRow, lambda cls: (cls.total > 0), include_aliases=True))",
    );
  });
});

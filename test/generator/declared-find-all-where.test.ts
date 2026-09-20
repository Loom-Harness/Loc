// A find the author DECLARED as `all`, with a `where`, on all five backends.
//
// `find all(): Doc[] where ownerUserId != ""` is an ordinary read restriction.
// Two backends DROPPED it — silently, with no compile error and no diagnostic:
//
//   node    `.where(ne(schema.docs.ownerUserId, ""))`             ✅
//   dotnet  `.Where(x => x.OwnerUserId != "")`                    ✅
//   java    `@Query("… where e.ownerUserId <> ''")`               ✅
//   python  `async def all(self)` running `select(DocRow)`        ❌ no where
//   elixir  `def list` running `Repo.all(Api.C.Doc)`              ❌ no where
//
// Both drop every find NAMED `all` from their custom-find list (`emittableFinds`
// / `customFindsOf`) to avoid colliding with the CRUD `list` seam — but that
// NAME test cannot tell the enrichment-synthesized auto-`findAll` (which carries
// no filter) from an author-declared `all` (which does).  So the author's
// restriction vanished and the UNFILTERED CRUD seam answered in its place.
//
// For a read restriction that is not a missing feature, it is an authorization
// bypass: the same model, generated for python or elixir instead of node,
// returns rows the `.ddd` says are out of scope.  It is also why the shape hid
// for so long — the F-007 repro names its find `all`, so on those two backends
// the predicate never reached the query lowerer at all and the generator
// reported success while emitting an unrestricted read.
//
// The fix applies the declared predicate to the seam that answers in its place,
// which is also why the `where` is asserted on the LIST path here rather than on
// a method of its own: there is no second method, by design.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

const SRC = (platform: string) => `
system DeclaredAll {
  subdomain S {
    context C {
      aggregate Doc {
        ownerUserId: string
        title: string
      }
      repository Docs for Doc {
        find all(): Doc[] where ownerUserId != ""
      }
    }
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: ${platform} contexts: [C] dataSources: [st] port: 3000 }
}`;

/** One emitted file, by path suffix — fails loudly rather than asserting over
 *  an empty string when the emitter renames a file. */
function file(files: Map<string, string>, suffix: string): string {
  const hit = [...files.entries()].find(([p]) => p.endsWith(suffix));
  if (!hit) {
    throw new Error(
      `no emitted file ending in '${suffix}'.  Emitted:\n  ${[...files.keys()].join("\n  ")}`,
    );
  }
  return hit[1];
}

describe("a DECLARED `find all(...) where <pred>` reaches the emitted query", () => {
  it("python: the list seam carries the predicate", async () => {
    const files = await generateSystemFiles(SRC("python"));
    const repo = file(files, "app/db/repositories/doc_repository.py");
    const all = repo.slice(repo.indexOf("async def all("));
    const body = all.slice(0, all.indexOf("\n    async def", 1));
    // The regression: `select(DocRow)` with no `.where(...)` at all.
    expect(body).toContain('DocRow.owner_user_id != ""');
  });

  it("elixir: the list seam carries the predicate", async () => {
    const files = await generateSystemFiles(SRC("elixir"));
    const repo = file(files, "/c/doc_repository.ex");
    const list = repo.slice(repo.indexOf("def list"));
    const body = list.slice(0, list.indexOf("\n  end") + 1);
    // The regression: a bare `Repo.all(Api.C.Doc)`.
    expect(body).toContain('record.owner_user_id != ""');
  });

  it("node keeps its already-correct predicate", async () => {
    const files = await generateSystemFiles(SRC("node"));
    expect(file(files, "db/repositories/doc-repository.ts")).toContain(
      'schema.docs.ownerUserId, ""',
    );
  });

  it.each([
    ["dotnet", 'OwnerUserId != ""'],
    ["java", "e.ownerUserId <> ''"],
  ] as const)("%s keeps its already-correct predicate", async (platform, needle) => {
    const files = await generateSystemFiles(SRC(platform));
    // .NET and java each split the read across an interface / port and its
    // impl; assert over every emitted file so a move between them is not a
    // failure, while an ABSENT predicate still is.
    const hit = [...files.values()].some((c) => c.includes(needle));
    expect(hit, `no emitted ${platform} file carries the declared \`all\` predicate`).toBe(true);
  });
});

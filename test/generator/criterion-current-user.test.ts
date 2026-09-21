// `currentUser` INSIDE a repository read filter, across all five backends.
//
// Two defect classes, one `.ddd` (the corpus fixture `criterion-current-user`):
//
//  (1) THE PRINCIPAL WAS EMITTED UNBOUND.  The tenancy/capability path passes an
//      explicit principal accessor to each backend's query lowerer; the
//      AUTHOR-WRITTEN `where` path passed none, so the SAME emitted file got the
//      tenancy filter right and the author's criterion wrong.  python emitted a
//      bare `current_user` (`mypy`: `Name "current_user" is not defined` — at
//      runtime a `NameError`, i.e. HTTP 500 on every read through that
//      retrieval, and nothing but a type-checker would have said so); elixir the
//      same name inside an Ecto `from(… where: …)`, which `mix compile` rejects
//      with `unbound variable`; node a bare `currentUser` in a `run<Name>` that
//      declares no such parameter.
//
//  (2) A CLAIM OTHER THAN `.id` CRASHED CODEGEN.  `currentUser.role == "admin"`
//      has no column on either side; every narrow query renderer only
//      implemented `<column> <op> <value>` and returned null, which each caller
//      turns into `refuseOutOfVocabulary`.  `ddd parse` → `0 error(s)`;
//      `ddd generate system` → uncaught `QueryEmissionRefusal`, exit 1, nothing
//      written.  It is a REQUEST constant and now folds in the host language.
//
// The two live in one suite because the fixture's criterion is the row-level
// rule that needs BOTH fixed to be expressible at all — "a technician sees only
// their own documents, an admin sees all".
//
// WHAT THIS SUITE CAN AND CANNOT SEE.  It reads emitted TEXT, so it pins the
// accessor each backend binds and that the predicate is present.  Whether the
// result COMPILES is the corpus compile tier's job (`corpus-{tsc,python,elixir,
// java,dotnet}-build`), which is exactly why the fixture lives in the corpus
// rather than inline here — defect (1) was invisible to every emission
// assertion and visible to `mypy` / `mix compile` immediately.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";
import type { Backend } from "../fixtures/corpus/backends.js";
import { corpusSourceFor } from "../fixtures/corpus/harness.js";

const FEATURE = "criterion-current-user";

async function emit(backend: Backend): Promise<Map<string, string>> {
  return generateSystemFiles(corpusSourceFor(FEATURE, backend));
}

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

/** Every emitted file whose text mentions the aggregate's owner column — the
 *  places a read filter over it can possibly live. */
function filesMentioning(files: Map<string, string>, needle: string): string[] {
  return [...files.values()].filter((c) => c.includes(needle));
}

describe("currentUser in a repository read filter", () => {
  // -----------------------------------------------------------------------
  // Defect 2 — the whole model generates at all.
  // -----------------------------------------------------------------------
  it.each([
    "node",
    "dotnet",
    "java",
    "python",
    "vanilla",
  ] as const)("%s generates (a principal claim other than `.id` no longer refuses)", async (backend) => {
    // Before the fix this threw `QueryEmissionRefusal` on node and emitted a
    // predicate no toolchain accepts on python / elixir.  A bare `await
    // emit()` that resolves IS the assertion for the refusal half.
    const files = await emit(backend);
    expect(files.size).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // Defect 1 — the principal is BOUND, per backend, the way that backend's own
  // tenancy filter binds it.
  // -----------------------------------------------------------------------
  it("node: the retrieval runner reads the ambient accessor, not a bare `currentUser`", async () => {
    const files = await emit("node");
    const repo = file(files, "db/repositories/doc-repository.ts");
    // `runMyOwn` is the INLINE spelling.  (`runMyVisible` reifies its criterion
    // into a module-level fn that was always lowered against the accessor,
    // which is why the criterion spelling looked correct all along.)
    const runner = repo.slice(repo.indexOf("async runMyOwn"));
    expect(runner).toContain("requireCurrentUser()");
    // The precise regression: a `currentUser` that is NOT part of
    // `requireCurrentUser()` has nothing to bind it — `runMyOwn` takes only
    // `page`.  Strip the accessor calls first, then look at what is left.
    expect(runner.replaceAll("requireCurrentUser()", "")).not.toContain("currentUser");
  });

  it("python: the retrieval runner reads the ambient accessor, not a bare `current_user`", async () => {
    const files = await emit("python");
    const repo = file(files, "app/db/repositories/doc_repository.py");
    const runner = repo.slice(repo.indexOf("async def run_my_own"));
    const next = runner.indexOf("\n    async def", 1);
    const body = next === -1 ? runner : runner.slice(0, next);
    expect(body).toContain("require_current_user()");
    // `mypy`'s `[name-defined]` in test form: no `current_user` survives that
    // is not the accessor call, because `run_my_own` declares no such
    // parameter.
    expect(body.replaceAll("require_current_user()", "")).not.toContain("current_user");
    // …and the accessor is actually imported (an unimported one is the same
    // `NameError`, one line higher up).
    expect(repo).toMatch(/^from app\.auth\.user import .*\brequire_current_user\b/m);
  });

  it("elixir: the find and the retrieval both BIND and PIN the principal", async () => {
    const files = await emit("vanilla");
    const retrieval = file(files, "work/retrievals/my_visible.ex");
    // Bound from the caller-threaded opts…
    expect(retrieval).toContain("current_user = opts[:current_user]");
    // …and PINNED inside the query: an unpinned `current_user.<claim>` is not an
    // Ecto query expression at all (`unbound variable … in query`).  The pin is
    // also what makes a nil actor fail CLOSED (Ecto binds `= NULL`).
    expect(retrieval).toContain("^(current_user && current_user.id)");
    // Every `current_user.<claim>` read sits inside a pin.  An unpinned one —
    // the regression — would appear without the `current_user && ` guard in
    // front of it, which is what `mix compile` rejected.
    expect(retrieval).not.toMatch(/(?<!&& )current_user\.id/);

    const repo = file(files, "work/doc_repository.ex");
    const find = repo.slice(repo.indexOf("def visible("));
    // The find takes the actor as a trailing parameter (the same shape the
    // tenancy path uses) rather than referencing a name out of nowhere.
    expect(find).toMatch(/def visible\(current_user \\\\ nil\)/);
    expect(find).toContain("^(current_user && current_user.id)");
  });

  it("elixir: the controller and the context facade carry the matching arity", async () => {
    const files = await emit("vanilla");
    // A find head that takes the actor is useless if the caller never passes
    // one — the default `\\ nil` would silently scope the read to no rows.
    const controller = file(files, "controllers/doc_controller.ex");
    expect(controller).toContain("current_user = Map.get(conn.assigns, :current_user)");
    expect(controller).toMatch(/visible_doc\(current_user\)/);
    const facade = file(files, "/work.ex");
    expect(facade).toMatch(/defdelegate visible_doc\(current_user \\\\ nil\)/);
  });

  it.each([
    "dotnet",
    "java",
  ] as const)("%s keeps its already-correct principal accessor", async (backend) => {
    const files = await emit(backend);
    const needle = backend === "dotnet" ? "RequestContext.Current" : "currentUserAccessor";
    expect(filesMentioning(files, needle).length).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // Defect 2 — the request-constant term is FOLDED, and the column half of the
  // same `or` survives as real SQL.  A fold that swallowed the whole predicate
  // would return every row to every caller: the failure mode is an
  // authorization bypass, not a crash, so it is asserted per backend.
  // -----------------------------------------------------------------------
  it("node: the principal-claim term folds, the ownership term stays SQL", async () => {
    const repo = file(await emit("node"), "db/repositories/doc-repository.ts");
    expect(repo).toContain('requireCurrentUser().role === "admin"');
    expect(repo).toContain("eq(schema.docs.ownerUserId, requireCurrentUser().id)");
  });

  it("python: the principal-claim term folds, the ownership term stays SQL", async () => {
    const repo = file(await emit("python"), "app/db/repositories/doc_repository.py");
    expect(repo).toContain('.role == "admin"');
    expect(repo).toContain("DocRow.owner_user_id ==");
    // The fold produces a `ColumnElement[bool]`, never a plain Python `bool` —
    // the latter is a `mypy` `[arg-type]` at `.where(...)` and has no column for
    // SQLAlchemy to compile.
    expect(repo).toContain("DocRow.id.is_(None)");
  });
});

// ---------------------------------------------------------------------------
// Elixir / Phoenix (vanilla Ecto) — capability `filter` on a `shape: document`
// aggregate.
//
// A document aggregate persists as ONE jsonb `data` column, so there is no
// flattened column for an Ecto `where:` to narrow.  Every document read
// therefore evaluates the capability predicate IN-APP over the rehydrated
// `%<Agg>.Data{}` embed (`record = row.data`), exactly as node / java / python /
// dotnet do over their rehydrated instances.
//
// The three things this pins, each a distinct way to get it wrong:
//
//   1. EVERY read is scoped — `list`, `find_by_id`, each criterion find, and the
//      write-scope `find_by_id_for_write` the context facade delegates to
//      whenever `writeScopeFilter` is set (its absence was an undefined-function
//      break, not just a missing filter).
//   2. The `authz-filter` SENTINELS are desugared, not rendered.  `deny` is the
//      literal `false`; the `local` floor compares the row's own `tenantId`
//      against the claim.  Left alone they would emit an Ecto `fragment(...)`,
//      which is not valid Elixir outside a query.
//   3. A NIL principal is fail-CLOSED: `current_user != nil and (…)` guards the
//      conjunction, and each claim reads through `(current_user && …)`.  Without
//      the outer guard a nil claim compares EQUAL to a nil field in Elixir
//      (SQL's `= NULL` never matches) — a cross-tenant read for an actor-less
//      caller.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles, generateSystemFilesUnchecked } from "../../_helpers/generate.js";

const REFUSED_ON_ELIXIR =
  "the capability table refuses `shape: document` with `softDeletable` on elixir; this pins the emitter for the day a fixture lifts the pair";

/** Tenant-owned document aggregates under the tenant floor with a `deny write`
 *  (the write-scope load) + a `deny` carve-out — the `policy-document` corpus
 *  fixture's shape. */
const FLOOR_AND_DENY = `system PD {
  user { id: guid  role: string  tenantId: string }

  tenancy by user.tenantId of Org

  subdomain Core {
    context Main {
      aggregate Thing shape: document, with crudish, tenantOwned {
        label: string
      }
      aggregate Note shape: document, with crudish, tenantOwned {
        body: string
      }
      repository Things for Thing { }
      criterion ThingsByLabel(l: string) of Thing = this.label == l
      queryHandler ThingsLabelled(l: string): Thing paged {
        let r = Things.all(ThingsByLabel(l))
        return r
      }
      repository Notes for Note { }
      policy {
        deny write on Thing
        deny on Note
      }
    }
    context Registry {
      aggregate Org with crudish {
        name: string
        implements tenantRegistry
      }
      repository Orgs for Org { }
    }
  }
  api MainApi from Core {
    route GET "/things/by_label" -> Main.ThingsLabelled
  }
  storage primary { type: postgres }
  resource mainState { for: Main, kind: state, use: primary }
  resource registryState { for: Registry, kind: state, use: primary }
  deployable d {
    platform: elixir
    contexts: [Main, Registry]
    dataSources: [mainState, registryState]
    serves: MainApi
    port: 4000
    auth: required
  }
}`;

/** A NON-principal capability filter (softDelete) on a document aggregate — the
 *  actor-free half of the crossing.  No `current_user` anywhere. */
const NON_PRINCIPAL = `system SD {
  subdomain Core {
    context Main {
      aggregate Doc shape: document, with crudish, softDeletable {
        label: string
      }
      repository Docs for Doc { }
    }
  }
  api MainApi from Core
  storage primary { type: postgres }
  resource mainState { for: Main, kind: state, use: primary }
  deployable d {
    platform: elixir
    contexts: [Main]
    dataSources: [mainState]
    serves: MainApi
    port: 4000
  }
}`;

/** The `ignoring` BYPASS crossing: a document aggregate whose criterion reads
 *  each carry a different bypass — none, a NAMED capability, and `*`.  `renderDocFindFn`
 *  used to be handed the aggregate-level predicate, so the find's own
 *  `f.bypassAll` / `f.bypassCaps` never reached it and every `ignoring` clause
 *  was a silent no-op: an admin "show deleted" read still filtered deleted
 *  rows, with no diagnostic to say so. */
const DOC_IGNORING = `system DI {
  subdomain Core {
    context Main {
      aggregate Doc shape: document, with crudish, softDeletable {
        label: string
        note: string
      }
      repository Docs for Doc { }
      criterion DocsByLabel(l: string) of Doc = this.label == l
      criterion DocsByLabelAll(l: string) of Doc = this.label == l
      criterion DocsByNoteAny(n: string) of Doc = this.note == n
      queryHandler ListByLabel(l: string): Doc paged {
        let r = Docs.all(DocsByLabel(l))
        return r
      }
      queryHandler ListByLabelAll(l: string): Doc paged {
        let r = Docs.all(DocsByLabelAll(l)) ignoring softDeletable
        return r
      }
      queryHandler ListByNoteAny(n: string): Doc paged {
        let r = Docs.all(DocsByNoteAny(n)) ignoring *
        return r
      }
    }
  }
  api MainApi from Core {
    route GET "/docs/by_label" -> Main.ListByLabel
    route GET "/docs/by_label_all" -> Main.ListByLabelAll
    route GET "/docs/by_note_any" -> Main.ListByNoteAny
  }
  storage primary { type: postgres }
  resource mainState { for: Main, kind: state, use: primary }
  deployable d {
    platform: elixir
    contexts: [Main]
    dataSources: [mainState]
    serves: MainApi
    port: 4000
  }
}`;

/** The emitted module with `#` comment lines stripped — for assertions about
 *  what the generated CODE does, which must not be satisfied (or broken) by
 *  prose in a generated comment.  The `fragment(` assertions below are exactly
 *  that: the `__denied?/1` helper's comment names `fragment("false")` while
 *  explaining why the in-app path cannot use it, and a raw substring check
 *  cannot tell the two apart. */
const codeOf = (src: string): string =>
  src
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");

const THING_REPO = "d/lib/d/main/thing_repository.ex";
const DOC_REPO = "d/lib/d/main/doc_repository.ex";
const CONTEXT = "d/lib/d/main.ex";

describe("elixir/vanilla — capability filter on a shape: document aggregate", () => {
  it("scopes every document read: list, find_by_id, the criterion find, and the write-scope load", async () => {
    const files = await generateSystemFiles(FLOOR_AND_DENY);
    const repo = files.get(THING_REPO)!;

    // Each read rehydrates the embed and filters in memory.  `Repo.all/1` with
    // no `Enum.filter` after it would be the unfiltered cross-tenant read.
    expect(repo).toContain("def list(current_user \\\\ nil) do");
    expect(repo).toContain("|> Enum.filter(fn row ->");
    expect(repo).toContain("record = row.data");
    expect(repo).not.toMatch(/\{:ok, Repo\.all\(D\.Main\.Thing\)\}/);

    expect(repo).toContain("def find_by_id(id, current_user \\\\ nil) when is_binary(id) do");
    expect(repo).toContain("else: {:error, :not_found}");

    // The write-scope command-load member the context facade delegates to
    // (`deny write` reads no principal, so the parameter is unused).
    expect(repo).toContain(
      "def find_by_id_for_write(id, _current_user \\\\ nil) when is_binary(id) do",
    );
    expect(files.get(CONTEXT)!).toContain(
      "defdelegate get_thing_for_write(id, current_user \\\\ nil), to: D.Main.ThingRepository, as: :find_by_id_for_write",
    );

    // The criterion's own predicate is narrowed too, not only the auto-findAll.
    expect(repo).toContain(
      'def find_all_by_things_by_label(l, page \\\\ 1, page_size \\\\ 20, sort \\\\ "id", dir \\\\ "asc", current_user \\\\ nil) do',
    );
    expect(repo).toContain("(record.label == l) and (current_user != nil and (");
    // …and the facade's find defdelegate declares the matching arity.
    expect(files.get(CONTEXT)!).toContain(
      'defdelegate find_all_by_things_by_label_thing(l, page \\\\ 1, page_size \\\\ 20, sort \\\\ "id", dir \\\\ "asc", current_user \\\\ nil), to: D.Main.ThingRepository, as: :find_all_by_things_by_label',
    );
  });

  it("renders the tenant floor as an in-memory comparison, never an Ecto fragment", async () => {
    const repo = (await generateSystemFiles(FLOOR_AND_DENY)).get(THING_REPO)!;
    // The sentinel must not reach the query renderer: `fragment(...)` is only
    // legal inside an Ecto query, and a document read has none.  Asserted over
    // CODE, not comments — the emitted `__denied?/1` doc comment cites
    // `fragment("false")` when explaining why the SQL path needs no equivalent.
    expect(codeOf(repo)).not.toContain("fragment(");
    expect(repo).toContain("record.tenant_id == (current_user && current_user.operating_org)");
    // Visibility is flat: no org path is read (D-TENANCY-FLAT).
    expect(repo).not.toContain("data_key");
  });

  it("is fail-closed for an actor-less read (a nil principal matches no rows)", async () => {
    const repo = (await generateSystemFiles(FLOOR_AND_DENY)).get(THING_REPO)!;
    // Every principal-referencing conjunction is guarded.  Without this, an
    // in-process caller (`current_user` defaulting to nil) would compare nil to
    // a nil `tenantId`/claim and read ACROSS tenants — Elixir's `nil == nil` is
    // true where SQL's `= NULL` is not.
    const guards = repo.match(/current_user != nil and \(/g) ?? [];
    // list, find_by_id, find_all_by_things_by_label — the `deny write` load is
    // principal-free (`__denied?/1`).
    expect(guards.length).toBe(3);
  });

  it("keeps a NON-principal document filter actor-free (no current_user seam)", async () => {
    const repo = (await generateSystemFilesUnchecked(NON_PRINCIPAL, REFUSED_ON_ELIXIR)).get(
      DOC_REPO,
    )!;
    expect(repo).not.toContain("current_user");
    expect(repo).toContain("def list do");
    expect(repo).toContain("def find_by_id(id) when is_binary(id) do");
    // The soft-delete predicate runs in memory over the rehydrated embed.
    expect(repo).toContain("record = row.data");
    expect(repo).toContain("not record.is_deleted");
  });

  // ── `ignoring <Cap>` / `ignoring *` on a DOCUMENT criterion read ─────────
  //
  // The bypass is carried per-read on `FindIR` (`bypassAll` / `bypassCaps`) and
  // `vanillaDocCapabilityFilter` has always understood it — but the document
  // find renderer was handed the aggregate-level predicate instead of computing
  // its own, so the clause reached nothing.  Wrong DATA, fail-closed and
  // silent: the read the author wrote to SEE deleted rows returned none.
  // A widened paged read gets a find of its own, named for its stance, which
  // carries that stance into the document renderer.
  it("honours `ignoring <Cap>` on a document read — the named capability's predicate is dropped", async () => {
    const repo = codeOf(
      (await generateSystemFilesUnchecked(DOC_IGNORING, REFUSED_ON_ELIXIR)).get(DOC_REPO)!,
    );
    const fn = (name: string) =>
      repo.slice(repo.indexOf(`def ${name}(`), repo.indexOf(`def ${name}(`) + 400);

    // Control: the plain read keeps the soft-delete predicate.
    expect(fn("find_all_by_docs_by_label")).toContain(
      "(record.label == l) and (not record.is_deleted)",
    );
    // `ignoring softDeletable` drops exactly that one — the criterion's own
    // predicate survives untouched.
    const widened = fn("find_all_by_docs_by_label_all_ignoring_soft_deletable");
    expect(widened).toContain("record.label == l");
    expect(widened).not.toContain("is_deleted");
  });

  it("honours `ignoring *` on a document read — every capability predicate is dropped", async () => {
    const repo = codeOf(
      (await generateSystemFilesUnchecked(DOC_IGNORING, REFUSED_ON_ELIXIR)).get(DOC_REPO)!,
    );
    const at = repo.indexOf("def find_all_by_docs_by_note_any_ignoring_all(");
    const fn = repo.slice(at, at + 400);
    expect(fn).toContain("record.note == n");
    expect(fn).not.toContain("is_deleted");
  });

  it("a bypass on ONE find leaves every other read fully scoped", async () => {
    // The bypass is per-read.  A fix that recomputed the predicate globally (or
    // mutated the aggregate) would open `list` / `find_by_id` too — the exact
    // failure mode a "just drop the filter" repair produces.
    const repo = codeOf(
      (await generateSystemFilesUnchecked(DOC_IGNORING, REFUSED_ON_ELIXIR)).get(DOC_REPO)!,
    );
    const list = repo.slice(repo.indexOf("def list do"), repo.indexOf("def find_by_id("));
    expect(list).toContain("not record.is_deleted");
    const byId = repo.slice(repo.indexOf("def find_by_id("), repo.indexOf("def insert("));
    expect(byId).toContain("not record.is_deleted");
  });
});

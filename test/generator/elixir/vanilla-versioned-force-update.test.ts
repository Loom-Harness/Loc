import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// `Repo.update` must be FORCED on a `versioned` aggregate.
//
// The defect this pins (found 2026-09-07 by `lifecycle-guard`'s wire
// differential — golden `version` 2, elixir 1 on `GET /api/crates`):
//
//   `Ecto.Changeset.optimistic_lock/2` does NOT put its increment into
//   `changeset.changes`.  It defers it into a `prepare_changes` hook, and
//   `Ecto.Repo.Schema.do_update` decides whether to touch the database BEFORE
//   running those hooks:
//
//       if changeset.changes != %{} or force? do   # ecto/lib/ecto/repo/schema.ex
//
//   So a write whose USER changes are empty short-circuits to `{:ok, struct}`
//   with no SQL at all — the lock never increments, the CAS filter is never
//   applied, and the row's `version` silently stands still.  Two shapes reach
//   that state: an operation that assigns no field (only `emit`s an event), and
//   a PATCH whose attrs all equal the stored values.  The other four backends
//   issue the guarded UPDATE unconditionally, so this was a one-backend wire
//   divergence that no fixture could see until an assignment-free operation
//   existed.
//
// `force: true` makes Ecto run prepare, after which the lock's own
// `%{version: n + 1}` change clears the inner non-empty check and the UPDATE
// runs.  Non-versioned aggregates carry no lock — there would be no change for
// `force` to carry — so their emission stays byte-identical, which the second
// case below pins from the other side.
// ---------------------------------------------------------------------------

/** `Crate` is versioned by default (`applyDefaultVersioning`), and `release`
 *  assigns nothing — the exact shape that short-circuited. */
const VERSIONED = `
system Vers {
  subdomain S {
    context C {
      aggregate Crate {
        label: string
        operation touch() { }
      }
      repository Crates for Crate { }
    }
  }
  api A from S
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable d {
    platform: elixir
    contexts: [C]
    dataSources: [st]
    serves: A
    port: 4000
  }
}
`;

/** The document-shaped twin (`shape: document`) has its own repository emitter
 *  (`document-emit.ts`) with the same two write paths and the same trap. */
const DOCUMENT = VERSIONED.replace("aggregate Crate {", "aggregate Crate shape: document {");

describe("vanilla — a versioned write is forced past Ecto's empty-changeset short-circuit", () => {
  it("emits `force: true` on both the named-op seam and the generic update", async () => {
    const files = await generateSystemFiles(VERSIONED);
    const repo = files.get([...files.keys()].find((k) => k.endsWith("/c/crate_repository.ex"))!)!;
    // The named-operation seam — `touch()` assigns nothing, so without the
    // option its changeset reaches `Repo.update` empty and no SQL runs.
    expect(repo).toContain("Repo.update(changeset, force: true)");
    // The generic PATCH seam — same trap when every attr equals the stored
    // value.  `update_changeset` carries the `optimistic_lock` (changeset-emit).
    expect(repo).toContain("|> Repo.update(force: true)");
    // And the guard the force must not disturb: a stale write still raises,
    // still becomes a 409.
    expect(repo).toContain("Ecto.StaleEntryError -> {:error, :conflict}");
  });

  it("forces the document-shaped repository's two write paths too", async () => {
    const files = await generateSystemFiles(DOCUMENT);
    const repo = files.get([...files.keys()].find((k) => k.endsWith("/c/crate_repository.ex"))!)!;
    expect(repo).toContain("Repo.update(changeset, force: true)");
    expect(repo).toContain("|> Repo.update(force: true)");
    // Pin that this really is the document emitter, not the relational one
    // reached by a fixture that silently lost its `shape:` clause.
    expect(repo).toContain("document_update_changeset");
  });
});

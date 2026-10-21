import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// `X id[]` whose target aggregate lives in a SIBLING context — on vanilla
// (plain Ecto/Phoenix).
//
// A same-context `party: Pokemon id[]` is an Ecto `many_to_many` onto the
// target schema (vanilla-ref-collection.test.ts).  A foreign target has no
// schema module in the owner's context — and none at all on a deployable that
// does not host the target's context — so the same line named
// `Desk.Claims.Pol`, a module that does not exist: `mix compile
// --warnings-as-errors` failed "invalid association `others` … associated
// schema Desk.Claims.Pol does not exist" (claims eval D18, list position).
//
// The collection is now what every other backend stores: the raw target ids in
// the join table the shared migration already creates — a `has_many` onto a
// join-row schema whose `id` is the target id, written by `rows/2`, never
// resolved against the target table.  The compile + migrate leg is the
// `foreign-id-field` corpus fixture.
// ---------------------------------------------------------------------------

const SOURCE = `
system Cover {
  subdomain Ops {
    context Policies {
      aggregate Pol with crudish {
        name: string
      }
      repository Pols for Pol { }
    }
    context Claims {
      aggregate Clm with crudish {
        others: Pol id[]
        operation attach(p: Pol id) {
          others += p
        }
        operation detach(p: Pol id) {
          others -= p
        }
      }
      repository Clms for Clm {
        find holding(p: Pol id): Clm[] where this.others.contains(p)
      }
    }
  }
  storage primary { type: postgres }
  resource polState { for: Policies, kind: state, use: primary }
  resource clmState { for: Claims, kind: state, use: primary }
  deployable policies {
    platform: elixir
    contexts: [Policies]
    dataSources: [polState]
    port: 4000
  }
  deployable desk {
    platform: elixir
    contexts: [Claims]
    dataSources: [clmState]
    port: 4001
  }
}
`;

function file(files: Map<string, string>, suffix: string): string {
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return files.get(key!)!;
}

describe("vanilla `X id[]` over a foreign (sibling-context) target", () => {
  it("the owner schema has_many's a join-row schema — no association to the missing target module", async () => {
    const clm = file(await generateSystemFiles(SOURCE), "desk/lib/desk/claims/clm.ex");
    expect(clm).toContain(
      "has_many :others, Desk.Claims.ClmOthers, foreign_key: :clm_id, on_replace: :delete, preload_order: [asc: :id]",
    );
    expect(clm).not.toContain("many_to_many");
    expect(clm).not.toContain("Desk.Claims.Pol");
  });

  it("the join-row schema maps the migration's join table, exposing the target id as `id`", async () => {
    const files = await generateSystemFiles(SOURCE);
    const row = file(files, "desk/lib/desk/claims/clm_others.ex");
    expect(row).toContain("defmodule Desk.Claims.ClmOthers do");
    expect(row).toContain('@schema_prefix "claims"');
    expect(row).toContain('schema "clm_others" do');
    expect(row).toContain("field :clm_id, :binary_id, primary_key: true");
    expect(row).toContain("field :id, :binary_id, primary_key: true, source: :pol_id");
    expect(row).toContain("def rows(owner_id, ids) do");
    // The migration's join table carries exactly those columns.
    const migration = [...files.entries()].find(([k]) => k.endsWith("_create_clm_others.exs"))?.[1];
    expect(migration).toContain("add :clm_id, :uuid, primary_key: true");
    expect(migration).toContain("add :pol_id, :uuid, primary_key: true");
  });

  it("create/update write the id rows directly — never resolve ids against the target table", async () => {
    const repo = file(await generateSystemFiles(SOURCE), "desk/lib/desk/claims/clm_repository.ex");
    expect(repo).toContain('|> __put_ref_ids(:others, "others", attrs, Desk.Claims.ClmOthers)');
    expect(repo).toContain("defp __put_ref_ids(changeset, field, key, attrs, row_mod) do");
    expect(repo).toContain("defp __fetch_ref(attrs, key) do");
    // The same-context helper (a `from(t in target_mod …)` lookup) would sit
    // unused under --warnings-as-errors.
    expect(repo).not.toContain("__put_ref_coll");
    expect(repo).toContain("Repo.preload([:others])");
  });

  it("a named op's `+=`/`-=` persists through the join-row schema, not `__resolve_refs`", async () => {
    const ctx = file(await generateSystemFiles(SOURCE), "desk/lib/desk/claims.ex");
    expect(ctx).toContain("put_assoc(:others, Desk.Claims.ClmOthers.rows(record.id, others))");
    expect(ctx).not.toContain("__resolve_refs");
    // `__ref_id_list/1` still normalises the preloaded rows (`%{id: id}`).
    expect(ctx).toContain("defp __ref_id_list(");
  });
});

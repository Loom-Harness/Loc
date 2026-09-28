import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

// ---------------------------------------------------------------------------
// Elixir — a document aggregate's id must be TIME-ORDERED, because its
// whole-table read orders by it.
//
// The document schema declared `@primary_key {:id, :binary_id, autogenerate: true}`.
// A `:binary_id` autogenerate mints through `Ecto.UUID.autogenerate/0`, and ecto's
// `@default_version` is 4 — `bingenerate_v4/0`, `:crypto.strong_rand_bytes(16)`,
// purely random.  Meanwhile the whole-table read is `order_by(…, [r], r.id)` and
// the other four backends mint time-ordered v7 (`uuidv7` on node, `uuid6.uuid7` on
// python, java-uuid-generator on java, v7 on .NET).
//
// So elixir was the one backend where "ordered by id" was NOT insertion order: the
// read was deterministic within a query and a fresh random permutation on every
// boot.  It could only match a node-captured wire golden by luck — and it was
// measured doing exactly that, matching on one CI run and diverging on the next
// with a byte-identical emitter.
//
// The relational schemas (`schema-emit.ts`) have used the `UUIDv7` type since they
// were written, and `{:uuidv7, "~> 1.0"}` is already a dependency of every
// generated project.  The document schema was simply never switched over.
//
// THE TWO HALVES ARE PINNED TOGETHER ON PURPOSE.  An ordered read over a random
// id, or a time-ordered id whose read forgets to order, are both silently wrong
// and neither is visible in a status code.  A test that pinned only one of them
// would pass while the pair was broken.
// ---------------------------------------------------------------------------

const SRC = `
system S {
  subdomain D {
    context C {
      aggregate Doc shape: document, with crudish {
        title: string
      }
      repository Docs for Doc { }

      // The per-row projection over the same source: its row order IS the source
      // read's order, and it does NOT ride the repository — this emitter builds
      // its own read.
      projection DocTitles {
        heading: string
        from Doc as a
        select heading = a.title
      }
    }
  }
  api Api from D
  storage primary { type: postgres }
  resource cState { for: C, kind: state, use: primary }
  deployable d {
    platform: elixir
    contexts: [C]
    dataSources: [cState]
    serves: Api
    port: 3000
  }
}
`;

let cached: Map<string, string> | undefined;
const files = async (): Promise<Map<string, string>> => {
  cached ??= await generateSystemFiles(SRC);
  return cached;
};

const file = async (suffix: string): Promise<string> => {
  const f = await files();
  const k = [...f.keys()].find((key) => key.endsWith(suffix));
  expect(k, `${suffix} not emitted`).toBeDefined();
  return f.get(k as string) as string;
};

describe("elixir document aggregate — a time-ordered id, and a read that orders by it", () => {
  it("mints the document id with the time-ordered UUIDv7 type, not :binary_id", async () => {
    const schema = await file("lib/d/c/doc.ex");
    expect(schema).toContain("@primary_key {:id, UUIDv7, autogenerate: true}");
    // The exact declaration that minted random v4 ids.
    expect(schema).not.toContain("@primary_key {:id, :binary_id, autogenerate: true}");
  });

  it("uses the SAME id type a relational aggregate does — the inconsistency was the bug", async () => {
    const schema = await file("lib/d/c/doc.ex");
    // `schema-emit.ts` emits this for every relational aggregate.  Nothing about a
    // jsonb carrier calls for a different id, and the divergence is what made one
    // backend's row order unreproducible.
    expect(schema).toMatch(/@primary_key \{:id, UUIDv7, autogenerate: true\}/);
  });

  it("orders the repository whole-table read by that id", async () => {
    const repo = await file("lib/d/c/doc_repository.ex");
    expect(repo).toContain("Ecto.Query.order_by(D.C.Doc, [r], r.id)");
    // `order_by` is a macro; a fully-qualified call needs the require or the
    // module does not compile (`undefined variable "r"`).
    expect(repo).toContain("require Ecto.Query");
  });

  it("orders the query projection's own source read by that id", async () => {
    const proj = await file("lib/d/c/query_projections/doc_titles.ex");
    expect(proj).toContain("      |> Ecto.Query.order_by([r], r.id)");
    // The bare, unordered read this emitter produced before.
    expect(proj).not.toMatch(/Repo\.all\(D\.C\.Doc\)/);
    expect(proj).toContain("  require Ecto.Query");
    // NOT `from(record in <DocSchema>, …)`: putting a document read into an Ecto
    // `from` is the shape this emitter's original bug had, and
    // `query-projection-document-source.test.ts` bans it by name.
    expect(proj).not.toContain("from(record in D.C.Doc");
  });

  it("uuidv7 is a declared dependency of the generated project", async () => {
    // The type is referenced as a bare `UUIDv7` module with no alias, so it
    // resolves only because the hex package supplies it.
    expect(await file("mix.exs")).toContain('{:uuidv7, "~> 1.0"}');
  });
});

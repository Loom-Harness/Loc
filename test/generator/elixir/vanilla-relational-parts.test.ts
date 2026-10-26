import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// §11c — nested entity parts on a RELATIONAL (default-shape) vanilla (plain
// Ecto) aggregate.  `contains pipelines: Pipeline[]` persists as a child TABLE:
// a table-backed part schema with a `belongs_to` back to its owner, a root
// `has_many` + `cast_assoc`, and an operation persist tail that `put_assoc`s
// the mutated part list.
//
// Reading the parts back, persisting an in-operation append / single assign /
// removal / nested rebuild, are asserted by value on the elixir behavioural leg
// (`corpus/contained-part-removal`, `contained-part-rebuild`,
// `single-containment`).  What stays here is what no booted case reaches: the
// schema and migration shapes, the create-body `cast_assoc` (no corpus create
// carries parts), the update seam leaving the containment alone, the insert
// and update preloads, and a value-object collection's row rebuild.
// ---------------------------------------------------------------------------

const SOURCE = `
system RelParts {
  subdomain Core {
    context Catalog {
      aggregate Project {
        name: string
        active: bool
        contains pipelines: Pipeline[]
        entity Pipeline { label: string  runCount: int }
      }
      repository Projects for Project {
        find byName(n: string): Project[] where this.name == n
      }
    }
  }
  api CatalogApi from Core
  storage pg { type: postgres }
  resource projectState { for: Catalog, kind: state, use: pg }
  deployable api {
    platform: elixir
    contexts: [Catalog]
    dataSources: [projectState]
    serves: CatalogApi
    port: 4000
  }
}
`;

function file(files: Map<string, string>, suffix: string): string {
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return files.get(key!)!;
}

describe("vanilla relational entity parts (§11c)", () => {
  it("the root schema has_many's the part (relational, not embeds_many; no field)", async () => {
    const project = file(await generateSystemFiles(SOURCE), "/catalog/project.ex");
    expect(project).toContain(
      "has_many :pipelines, Api.Catalog.Pipeline, foreign_key: :project_id, on_replace: :delete",
    );
    expect(project).not.toContain("embeds_many :pipelines");
    expect(project).not.toContain("field :pipelines");
  });

  it("emits the part as a table-backed schema with belongs_to + timestamps + Jason encoder", async () => {
    const pipeline = file(await generateSystemFiles(SOURCE), "/catalog/pipeline.ex");
    expect(pipeline).toContain("use Ecto.Schema");
    expect(pipeline).toContain("@derive {Jason.Encoder, only: [:id, :label, :run_count]}");
    // Table-backed schema (a real table), NOT an embedded_schema.
    expect(pipeline).toContain('schema "pipelines" do');
    expect(pipeline).not.toContain("embedded_schema");
    expect(pipeline).toContain("field :label, :string");
    expect(pipeline).toContain("field :run_count, :integer");
    expect(pipeline).toContain(
      "belongs_to :project, Api.Catalog.Project, foreign_key: :project_id, type: :binary_id",
    );
    // The child table carries NOT-NULL timestamps in the migration → auto-stamp.
    expect(pipeline).toContain("timestamps(type: :utc_datetime)");
    expect(pipeline).toContain("cast(attrs, [:label, :run_count])");
    // §15: the part changeset snakes ITS OWN top-level keys, so a `cast_assoc`
    // nested body with camelCase keys (`{"runCount": 3}`) casts cleanly instead of
    // dropping `run_count` → not-null violation.
    expect(pipeline).toContain("attrs = __normalize_keys(attrs)");
    expect(pipeline).toContain("defp __normalize_keys(attrs) when is_map(attrs) do");
    expect(pipeline).toContain("{k, v} when is_binary(k) -> {Macro.underscore(k), v}");
  });

  it("base_changeset cast_assocs the containment (create path), but update_changeset does NOT", async () => {
    const cs = file(await generateSystemFiles(SOURCE), "/catalog/project_changeset.ex");
    // Create seam casts the containment (so a create body can seed pipelines).
    expect(cs).toContain("|> cast_assoc(:pipelines, with: &Api.Catalog.Pipeline.changeset/2)");
    expect(cs).not.toContain("cast_embed(:pipelines)");
    // Generic PATCH seam must NOT touch the containment — a `PATCH {"pipelines":
    // []}` would otherwise bulk-delete the child rows (on_replace: :delete),
    // bypassing the aggregate's own `addPipeline` precondition.  Containment
    // mutation goes through operations, so `update_changeset` casts scalars only.
    const updateCs = cs.slice(cs.indexOf("def update_changeset"));
    expect(cs).toContain("def update_changeset(struct, attrs) do");
    expect(updateCs).not.toContain("cast_assoc(:pipelines");
  });

  it("the repository preloads the containment on the update and insert seams", async () => {
    const repo = file(await generateSystemFiles(SOURCE), "/catalog/project_repository.ex");
    // update preloads the existing assoc before cast_assoc.
    expect(repo).toContain("record |> Repo.preload([:pipelines])");
    // insert preloads the containment on its RESULT: a create body that omits
    // `pipelines` leaves the assoc `%Ecto.Association.NotLoaded{}` (cast_assoc
    // doesn't touch an absent key), and the serializer's `Map.from_struct` would
    // then hand that sentinel to Jason → `cannot encode association … not loaded`.
    expect(repo).toContain("      {:ok, record} -> {:ok, record |> Repo.preload([:pipelines])}");
  });

  it("the child-table migration matches the schema (project_id FK → projects)", async () => {
    const mig = file(await generateSystemFiles(SOURCE), "_create_pipelines.exs");
    expect(mig).toContain("create table(:pipelines");
    expect(mig).toContain("add :project_id, references(:projects");
    expect(mig).toContain("timestamps()");
  });
});

// ---------------------------------------------------------------------------
// §11c follow-up — in-operation mutation of a RELATIONAL containment.  An
// `operation addPipeline(...) { pipelines += Pipeline { … } }` body appends the
// part STRUCT (`%Api.Catalog.Pipeline{…}`) to the threaded `record` and the
// persist tail `put_assoc`s the mutated list (NOT `put_embed`, which is the
// embedded-shape path).  The schema's `on_replace: :delete` rewrites the child
// rows.  Mirrors `vanilla-embed-parts.test.ts`'s `put_embed` assertion.
// ---------------------------------------------------------------------------

const REMOVAL_SOURCE = `
system Removal {
  subdomain Core {
    context Shop {
      valueobject Charge { label: string  amount: int }
      aggregate Cart {
        name: string
        charges: Charge[]
        contains lines: Line[]
        entity Line { sku: string  contains notes: Note[] }
        entity Note { text: string }
        operation drop(sku: string) { lines -= lines.where(l => l.sku == sku).first() }
        operation dropCharge(label: string) { charges -= charges.where(c => c.label == label).first() }
        operation dropCounted(sku: string): int {
          lines -= lines.where(l => l.sku == sku).first()
          return lines.count
        }
        operation rename(n: string) { name := n }
      }
      repository Carts for Cart { }
    }
  }
  api ShopApi from Core
  storage pg { type: postgres }
  resource cartState { for: Shop, kind: state, use: pg }
  deployable api {
    platform: elixir
    contexts: [Shop]
    dataSources: [cartState]
    serves: ShopApi
    port: 4000
  }
}
`;

function fnBody(src: string, head: string): string {
  const start = src.indexOf(head);
  expect(start, `${head} not emitted`).toBeGreaterThan(-1);
  return src.slice(start, src.indexOf("\n  end\n", start));
}

describe("vanilla containment removal persists (M-T6.94)", () => {
  it("a value-object collection op put_assocs rebuilt rows, never force_change", async () => {
    const ctx = file(await generateSystemFiles(REMOVAL_SOURCE), "/shop.ex");
    const body = fnBody(ctx, "def drop_charge_cart(");
    expect(body).toContain("record_before = record");
    expect(body).toContain("Ecto.Changeset.put_assoc(:charges, __put_value_rows(record.charges))");
    expect(ctx).not.toContain("force_change(:charges");
    expect(ctx).toContain("defp __put_value_rows(list) when is_list(list) do");
  });
});

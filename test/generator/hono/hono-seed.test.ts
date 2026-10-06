import { describe, expect, it } from "vitest";
import { generateSystems } from "../../../src/system/index.js";
import { parseString } from "../../_helpers/index.js";

// A context with an aggregate covering the field kinds a seed renders:
// string, int, enum (bare ref), and a value-object field (BuilderCall →
// `new Money(...)`).  Two datasets: `default` (always) + `demo` (LOOM_SEED).
const FIXTURE = `system AcmeSeed {
  subdomain Shop {
    context Catalog {
      enum Tier { Free, Pro }
      valueobject Money { amount: decimal currency: string }
      aggregate Product with crudish {
        sku: string
        price: Money
        tier: Tier
        stock: int
      }
      repository Products for Product { }

      seed default {
        Product { sku: "BASE-1", price: Money { amount: 1.0, currency: "USD" }, tier: Free, stock: 1 }
      }
      seed demo {
        Product { sku: "DEMO-1", price: Money { amount: 9.99, currency: "USD" }, tier: Pro, stock: 10 }
        Product { sku: "DEMO-2", price: Money { amount: 19.99, currency: "USD" }, tier: Pro, stock: 5 }
      }
    }
  }
  api ShopApi from Shop
  storage primary { type: postgres }
  resource catalogState { for: Catalog, kind: state, use: primary }
  deployable api {
    platform: node
    contexts: [Catalog]
    dataSources: [catalogState]
    serves: ShopApi
    port: 3000
  }
}
`;

async function build(): Promise<Map<string, string>> {
  const { model, errors } = await parseString(FIXTURE);
  if (errors.length) throw new Error(`fixture has validation errors:\n${errors.join("\n")}`);
  return generateSystems(model).files;
}

function find(
  files: Map<string, string>,
  re: RegExp,
  also: (k: string) => boolean = () => true,
): string {
  for (const [k, v] of files) if (re.test(k) && also(k)) return v;
  throw new Error(`no file matched ${re}`);
}

describe("Hono database seeding (Phase 2, domain path)", () => {
  it("is ship-once per dataset via the __loom_seed marker (D-SEED-IDEMPOTENCY)", async () => {
    const files = await build();
    const seed = find(files, /\/db\/seed\.ts$/);
    expect(seed).toContain('CREATE TABLE IF NOT EXISTS "__loom_seed"');
    expect(seed).toContain("if (await alreadySeeded(db,");
    expect(seed).toContain("await markSeeded(db,");
  });

  it("gates non-default datasets on LOOM_SEED; default always runs", async () => {
    const files = await build();
    const seed = find(files, /\/db\/seed\.ts$/);
    expect(seed).toContain("process.env.LOOM_SEED");
    expect(seed).toContain('return dataset === "default" || requested.has(dataset);');
    expect(seed).toContain("async function seedDefault(");
    expect(seed).toContain("async function seedDemo(");
  });

  it("wires the seeder into package.json and index.ts boot", async () => {
    const files = await build();
    const pkg = JSON.parse(find(files, /\/package\.json$/));
    expect(pkg.scripts["db:seed"]).toBe("tsx db/seed-cli.ts");

    // The project-root index.ts (not http/index.ts).
    const index = find(files, /(^|\/)index\.ts$/, (k) => !/\/http\//.test(k));
    expect(index).toContain('import { runSeeds } from "./db/seed"');
    expect(index).toContain("await runSeeds(db);");
    // Seeding runs after migrations.
    expect(index.indexOf("await migrate(")).toBeLessThan(index.indexOf("await runSeeds("));
  });

  it("keeps db/seed.ts a pure module — the CLI entry lives in db/seed-cli.ts", async () => {
    // A run-directly guard INSIDE the importable module misfires once tsup
    // bundles seed.ts into dist/index.js (there `import.meta.url` IS the
    // entrypoint), seeding at module load BEFORE the top-level migrate —
    // first boot then dies on `relation ... does not exist` (caught live by
    // conformance-parity).  The self-executing entry must stay in its own,
    // never-imported file.
    const files = await build();
    const seed = find(files, /\/db\/seed\.ts$/);
    expect(seed).not.toContain("import.meta.url");
    expect(seed).not.toContain("void main()");
    const cli = find(files, /\/db\/seed-cli\.ts$/);
    expect(cli).toContain('import { runSeeds } from "./seed"');
    expect(cli).toContain("void main();");
  });

  it("omits seed wiring entirely when no seed block is declared", async () => {
    const noSeed = FIXTURE.replace(/seed default \{[\s\S]*?\n {6}\}\n/, "").replace(
      /seed demo \{[\s\S]*?\n {6}\}\n/,
      "",
    );
    const { model, errors } = await parseString(noSeed);
    if (errors.length) throw new Error(errors.join("\n"));
    const files = generateSystems(model).files;
    for (const k of files.keys()) expect(k).not.toMatch(/\/db\/seed\.ts$/);
    const pkg = JSON.parse(find(files, /\/package\.json$/));
    expect(pkg.scripts["db:seed"]).toBeUndefined();
  });
});

describe("Hono seeding — raw explicit-id path", () => {
  const RAW = `system S {
    subdomain Sales { context Sales {
      aggregate Customer with crudish { name: string }
      aggregate Order with crudish { customerId: Customer id status: string }
      repository Customers for Customer { }
      repository Orders for Order { }
      seed reference raw {
        Customer { id: "c1", name: "Acme" }
        Order { id: "o1", customerId: "c1", status: "new" }
      }
    } }
    api A from Sales
    storage primary { type: postgres }
    resource salesState { for: Sales, kind: state, use: primary }
    deployable api { platform: node contexts: [Sales] dataSources: [salesState] serves: A port: 3000 }
  }`;

  it("emits direct INSERTs via db.execute(sql.raw(...)) with explicit id + FK", async () => {
    const { model, errors } = await parseString(RAW);
    if (errors.length) throw new Error(errors.join("\n"));
    const seed = find(generateSystems(model).files, /\/db\/seed\.ts$/);
    // Schema-qualified, because every accepted model qualifies: a backend
    // deployable hosting a context MUST bind a dataSource for it
    // (`loom.datasource-binding-missing`), and that binding puts the
    // context's tables in their own Postgres schema.  The bare
    // `INSERT INTO "customers"` this used to pin is a shape no user can
    // generate — it only existed because the fixture skipped the binding.
    expect(seed).toContain(
      'db.execute(sql.raw("INSERT INTO \\"sales\\".\\"customers\\" (\\"id\\", \\"name\\") VALUES (\'c1\', \'Acme\')"))',
    );
    expect(seed).toContain(
      'INSERT INTO \\"sales\\".\\"orders\\" (\\"id\\", \\"customer_id\\", \\"status\\")',
    );
    expect(seed).not.toContain("Customer.create(");
  });
});

describe("Hono seeding — the raw INSERT is schema-qualified", () => {
  // A dataSource binding routes every table of the context into its own Postgres
  // schema (`pgSchema("sales")`, and `"sales"."customers"` in the migration DDL).
  // The DOMAIN seed path goes through the drizzle table object and is qualified
  // by construction; the RAW path builds SQL by hand, and did NOT qualify it — so
  // `INSERT INTO "customers"` could never resolve a table created as
  // `"sales"."customers"`, and every `default`-dataset raw row was a first-boot
  // break (`relation "customers" does not exist`) in shipped output.  python and
  // java qualified theirs from the start; this surfaced when the behavioural node
  // leg started running the emitted seeder at all (#2517).
  const RAW_WITH_SCHEMA = `system S {
    subdomain Sales { context Sales {
      aggregate Customer with crudish { name: string }
      repository Customers for Customer { }
      seed default raw {
        Customer { id: "11111111-1111-1111-1111-111111111111", name: "Acme" }
      }
    } }
    api A from Sales
    storage primary { type: postgres }
    resource salesState { for: Sales, kind: state, use: primary }
    deployable api { platform: node contexts: [Sales] dataSources: [salesState] serves: A port: 3000 }
  }`;

  it("qualifies the raw INSERT with the aggregate's dataSource schema", async () => {
    const { model, errors } = await parseString(RAW_WITH_SCHEMA);
    if (errors.length) throw new Error(errors.join("\n"));
    const files = generateSystems(model).files;
    const seed = find(files, /\/db\/seed\.ts$/);
    expect(seed).toContain('INSERT INTO \\"sales\\".\\"customers\\"');
    // …the same qualifier the drizzle schema and the migration DDL use, which is
    // the invariant that matters: three emitted views of one table must agree.
    expect(find(files, /\/db\/schema\.ts$/)).toContain('pgSchema("sales")');
    expect(find(files, /migrations\/.*\.sql$/)).toContain('"sales"."customers"');
  });
});

describe("Hono seeding — event-sourced aggregate (M-T6.52)", () => {
  // `owner` is the create action's ONLY param; `balance` is a real aggregate
  // FIELD folded by the applier, not a create param — the shared seeder model
  // must build the call from the former, not the latter.
  const ES = `system EsSeed {
    subdomain Bank { context Bank {
      event Opened { account: Account id, owner: string }
      aggregate Account persistedAs: eventLog {
        owner: string
        balance: int
        create open(owner: string) { emit Opened { account: id, owner: owner } }
        apply(e: Opened) { owner := e.owner  balance := 0 }
      }
      repository Accounts for Account { }
      seed default { Account { owner: "seeded-alice" } }
    } }
    api A from Bank
    storage primary { type: postgres }
    resource bankLog { for: Bank, kind: eventLog, use: primary }
    deployable api { platform: node contexts: [Bank] dataSources: [bankLog] serves: A port: 3000 }
  }`;

  it("appends the creation event through the domain create + repository save", async () => {
    const { model, errors } = await parseString(ES);
    if (errors.length) throw new Error(errors.join("\n"));
    const seed = find(generateSystems(model).files, /\/db\/seed\.ts$/);
    // The object-literal create call carries ONLY the create action's own
    // param (`owner`) — never `balance`, which forCreateInput(agg.fields)
    // would have included.
    expect(seed).toContain('Account.create({ owner: "seeded-alice" })');
    expect(seed).not.toContain("balance:");
    expect(seed).toContain("await accountRepo.save(");
  });
});

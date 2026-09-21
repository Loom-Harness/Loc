import { NodeFileSystem } from "langium/node";
import { parseHelper } from "langium/test";
import { describe, expect, it } from "vitest";
import { generateDotnetForContexts } from "../../../src/generator/dotnet/index.js";
import { enrichLoomModel } from "../../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../../src/ir/lower/lower.js";
import { createDddServices } from "../../../src/language/ddd-module.js";
import type { Model } from "../../../src/language/generated/ast.js";

// .NET TPH (sharedTable) emission — aggregate-inheritance.md I2.  The whole
// hierarchy maps to one EF table named for the abstract base, with a `kind`
// discriminator (value = the concrete's name, matching the Hono/Drizzle wire).
// The base owns the shared Id (EF Core native HasDiscriminator); concretes are
// derived entities that share the table and declare no Id of their own.

async function emitTph(): Promise<Map<string, string>> {
  const services = createDddServices(NodeFileSystem);
  const helper = parseHelper(services.Ddd);
  const doc = await helper(
    `
      system Acme {
        subdomain Registry {
          context Parties {
            abstract aggregate Party inheritanceUsing: sharedTable {
              name: string
            }
            aggregate Customer extends Party {
              creditLimit: int
            }
            aggregate Vendor extends Party {
              rating: int
            }
            repository Customers for Customer { }
            repository Vendors for Vendor { }
          }
        }
        deployable api {
          platform: dotnet
          contexts: [Parties]
          port: 8080
        }
      }
    `,
    { validation: true },
  );
  const loom = enrichLoomModel(lowerModel(doc.parseResult.value as Model));
  const sys = loom.systems[0]!;
  const dep = sys.deployables.find((d) => d.platform === "dotnet")!;
  const contexts = sys.subdomains.flatMap((m) => m.contexts);
  const ns = dep.name[0]!.toUpperCase() + dep.name.slice(1);
  return generateDotnetForContexts(contexts, ns, { deployable: dep, sys });
}

describe(".NET TPH emission", () => {
  it("the base is a mapped abstract entity that owns the shared Id", async () => {
    const out = await emitTph();
    const base = [...out].find(([p]) => p.endsWith("Party.cs"))?.[1] ?? "";
    expect(base).toContain("public abstract class Party");
    expect(base).toContain("public PartyId Id { get; internal set; }");
  });

  it("the base config maps one table + HasDiscriminator over the concretes", async () => {
    const out = await emitTph();
    const cfg = [...out].find(([p]) => p.endsWith("PartyConfiguration.cs"))?.[1] ?? "";
    expect(cfg).toContain('builder.ToTable("parties")');
    expect(cfg).toContain("builder.HasKey(x => x.Id)");
    expect(cfg).toContain('builder.HasDiscriminator<string>("kind")');
    expect(cfg).toContain('.HasValue<Customer>("Customer")');
    expect(cfg).toContain('.HasValue<Vendor>("Vendor")');
    // imports the concrete namespaces it names
    expect(cfg).toContain("using Api.Domain.Customers;");
    expect(cfg).toContain("using Api.Domain.Vendors;");
  });

  it("a concrete is a derived entity that shares the base Id (declares none)", async () => {
    const out = await emitTph();
    const cust = [...out].find(([p]) => p.endsWith("Customer.cs"))?.[1] ?? "";
    expect(cust).toContain("public sealed class Customer : Party");
    // Inherits Id from the base — must NOT re-declare it (CS0108 under /warnaserror).
    expect(cust).not.toContain("public CustomerId Id");
    // Its create factory mints the inherited PartyId, not a CustomerId.
    expect(cust).toContain("e.Id = new PartyId(");
  });

  // M-T5.7 — the identity type that LEAVES the hierarchy.  Every emitter renders
  // a referenced id as `<targetName>Id` from the IR's own `targetName`,
  // independently, in ~20 places, so a cross-aggregate `customer: Customer id`
  // produced `CustomerId` on the field / event record / commands / EF converter
  // while `ICustomerRepository.GetByIdAsync` took `PartyId` — CS1503 the first
  // time generated code passed one to the other.  A global ALIAS makes them one
  // CLR type, which is what the shared table already means.
  it("a TPH concrete's id class is a global alias for the hierarchy root's", async () => {
    const out = await emitTph();
    const at = (p: string): string => [...out].find(([k]) => k.endsWith(p))?.[1] ?? "";
    const alias = at("Domain/Ids/CustomerId.cs");
    expect(alias).toContain("global using CustomerId = Api.Domain.Ids.PartyId;");
    // An alias, not a second struct: two distinct structs is exactly the bug.
    expect(alias).not.toContain("record struct CustomerId");
    expect(at("Domain/Ids/VendorId.cs")).toContain(
      "global using VendorId = Api.Domain.Ids.PartyId;",
    );
    // The ROOT keeps a real struct — aliasing it to itself would be circular.
    expect(at("Domain/Ids/PartyId.cs")).toContain(
      "public readonly record struct PartyId(Guid Value)",
    );
  });

  it("a concrete config carries only its own columns (no ToTable/HasKey)", async () => {
    const out = await emitTph();
    const cfg = [...out].find(([p]) => p.endsWith("CustomerConfiguration.cs"))?.[1] ?? "";
    expect(cfg).toContain("IEntityTypeConfiguration<Customer>");
    expect(cfg).not.toContain("ToTable");
    expect(cfg).not.toContain("HasKey");
  });

  it("the DbContext exposes DbSet<Party> and does NOT Ignore the TPH base", async () => {
    const out = await emitTph();
    const db = [...out].find(([p]) => p.endsWith("AppDbContext.cs"))?.[1] ?? "";
    expect(db).toContain("DbSet<Party> Parties");
    expect(db).not.toContain("modelBuilder.Ignore<Party>()");
    expect(db).toContain("new Configurations.PartyConfiguration()");
  });

  // A `sharedTable` base with ZERO shared-table concretes.  Reachable and
  // legitimate: `loom.es-tph-forced-own-table` forces a `shape: embedded` /
  // `shape: document` / `persistedAs: eventLog` concrete to
  // `inheritanceUsing: ownTable`, so a hierarchy whose only concrete takes that
  // path leaves the base owning the shared table with nothing sharing it.  The
  // `;` used to hang off the last `.HasValue<…>` line ALONE, so the map emitted
  // nothing and the `HasDiscriminator` opener was left unterminated —
  // `CS1002: ; expected`, and the whole project failed to build.  Found by the
  // pairwise compile oracle (`versioned-embedded-none-tph-paged-default`), which
  // was red on `main` for a week.
  it("a TPH base with no shared-table concrete still terminates the discriminator statement", async () => {
    const services = createDddServices(NodeFileSystem);
    const helper = parseHelper(services.Ddd);
    const doc = await helper(
      `
        system Acme {
          subdomain Registry {
            context Parties {
              abstract aggregate Party inheritanceUsing: sharedTable {
                name: string
              }
              aggregate Customer extends Party shape: embedded, inheritanceUsing: ownTable {
                creditLimit: int
              }
              repository Customers for Customer { }
            }
          }
          deployable api {
            platform: dotnet
            contexts: [Parties]
            port: 8080
          }
        }
      `,
      { validation: true },
    );
    const loom = enrichLoomModel(lowerModel(doc.parseResult.value as Model));
    const sys = loom.systems[0]!;
    const dep = sys.deployables.find((d) => d.platform === "dotnet")!;
    const out = generateDotnetForContexts(
      sys.subdomains.flatMap((m) => m.contexts),
      "Api",
      {
        deployable: dep,
        sys,
      },
    );
    const cfg = [...out].find(([p]) => p.endsWith("PartyConfiguration.cs"))?.[1] ?? "";
    // The discriminator COLUMN still maps (the migration stamps `kind NOT NULL`
    // on the base table) — it is the statement that has to close.
    expect(cfg).toContain('builder.HasDiscriminator<string>("kind");');
    expect(cfg).not.toContain(".HasValue<");
    // Nothing in the configuration body may be left dangling: every statement
    // line ends in `;`, `{` or `}`.  Asserting the shape rather than the one
    // known line keeps the gate honest if another chain grows the same bug.
    const body = cfg.split("\n").map((l) => l.trim());
    const dangling = body.filter(
      (l) => l.startsWith("builder.") && !l.endsWith(";") && !l.endsWith("("),
    );
    expect(dangling).toEqual([]);
  });
});

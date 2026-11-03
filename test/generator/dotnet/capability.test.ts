// .NET capability translation, post-Phase-3-revert.
//
// After splitting stdlib macros into level-correct trios
// (capability behavior at context; state at aggregate), the
// generator has no capability-grouping infrastructure.  Filters
// install per-EntityConfiguration; stamps go through the
// registry-driven SaveChangesInterceptor.  No marker interfaces,
// no DbContext-level loops, no `<Cap>Filters.cs` helpers.
//
// What the tests verify:
//   - Entity classes are plain `public sealed class Order` with
//     no `: I<Capability>` clause regardless of `implements` decls.
//   - No `Domain/Common/I*.cs` marker interfaces emitted.
//   - No `<Cap>Filters.cs` static helpers emitted.
//   - `builder.HasQueryFilter(...)` lives in `<Aggregate>Configuration.cs`
//     for any aggregate whose propagated IR carries `contextFilters`.
//   - `AppDbContext.OnModelCreating` stays minimal — just
//     `ApplyConfiguration` calls, no `foreach` loop.
//   - `AuditableInterceptor.cs` still emitted when any aggregate
//     has stamping rules.  Body is the registry-driven switch.

import { describe, expect, it } from "vitest";
import { generateBackendFiles, generateSystemFiles } from "../../_helpers/generate.js";

/** The .NET project for a bare-context fixture, hosted on one deployable. */
function dotnetFiles(source: string): Promise<Map<string, string>> {
  return generateBackendFiles(source, "dotnet");
}

/**
 * `dotnetFiles` for a fixture whose stamps read `currentUser` (`auditable`'s
 * `createdBy := currentUser`): the hosting deployable must carry
 * `auth: required` and the system a `user { }` block, or phase ⑦ rejects it
 * (`loom.stamp-principal-without-auth`) — there is no principal to stamp from.
 * Keys come back with the `app/` prefix stripped.
 */
async function dotnetFilesWithAuth(context: string): Promise<Map<string, string>> {
  const name = /\bcontext\s+([A-Z]\w*)/.exec(context)?.[1];
  if (!name) throw new Error("fixture declares no context");
  const files = await generateSystemFiles(`
    system Fixture {
      user { id: guid  role: string }
      subdomain Fixture {
        ${context}
      }
      api FixtureApi from Fixture
      storage pg { type: postgres }
      resource st { for: ${name}, kind: state, use: pg }
      deployable app {
        platform: dotnet
        contexts: [${name}]
        dataSources: [st]
        serves: FixtureApi
        auth: required
      }
    }
  `);
  const out = new Map<string, string>();
  for (const [k, v] of files) if (k.startsWith("app/")) out.set(k.slice(4), v);
  return out;
}

// `auditable` references Id<User> and currentUser, so the source
// always declares a sibling User aggregate.
const aggregateOnly = (extras: string) => `
  context Sales {
    aggregate User { name: string }
    aggregate Order ${extras} {
      subject: string
    }
    repository Orders for Order { }
    repository Users for User { }
  }
`;

// Capability state and behaviour both ride the aggregate: the prelude
// capabilities (`softDeletable` / `auditable`) contribute the state + the
// filter / stamps, and the stdlib `softDelete` ops macro is aggregate-level
// too.  There is no context-level `audit` / `softDelete` macro.
const withCaps = (aggMacros: string) => `
  context Sales {
    aggregate User { name: string }
    aggregate Order with ${aggMacros} {
      subject: string
    }
    repository Orders for Order { }
    repository Users for User { }
  }
`;

describe(".NET generator: no capability artefacts emitted", () => {
  it("no Domain/Common/I*.cs marker interfaces", async () => {
    const files = await dotnetFilesWithAuth(withCaps("auditable, softDeletable, softDelete"));
    const markers = [...files.keys()].filter(
      (k) => k.startsWith("Domain/Common/I") && k.endsWith(".cs"),
    );
    expect(markers).toEqual([]);
  });

  it("no <Capability>Filters.cs helper", async () => {
    const files = await dotnetFiles(withCaps("softDeletable, softDelete"));
    const helpers = [...files.keys()].filter(
      (k) => k.startsWith("Infrastructure/Persistence/") && k.endsWith("Filters.cs"),
    );
    expect(helpers).toEqual([]);
  });

  it("entity class declaration has no `: I<Cap>` clause", async () => {
    const files = await dotnetFilesWithAuth(withCaps("auditable, softDeletable, softDelete"));
    const orderCs = files.get("Domain/Orders/Order.cs")!;
    expect(orderCs).toMatch(/public sealed class Order\n/);
    expect(orderCs).not.toMatch(/: I/);
  });

  it("OnModelCreating has no `foreach (var entityType ...)` loop", async () => {
    const files = await dotnetFiles(withCaps("softDeletable, softDelete"));
    const ctx = files.get("Infrastructure/Persistence/AppDbContext.cs")!;
    expect(ctx).not.toMatch(/foreach \(var entityType/);
  });
});

describe(".NET generator: HasQueryFilter installs per-EntityConfiguration", () => {
  it("emits one `builder.HasQueryFilter(...)` per propagated filter on the matching config", async () => {
    const files = await dotnetFiles(withCaps("softDeletable, softDelete"));
    const cfg = files.get("Infrastructure/Persistence/Configurations/OrderConfiguration.cs")!;
    expect(cfg).toMatch(/builder\.HasQueryFilter\("IsDeletedFilter", x => !x\.IsDeleted\)/);
  });

  it("softDelete operation stamps DeletedAt with DateTime.UtcNow (not a bogus Now() call)", async () => {
    // Regression: the softDelete macro built `now()` as a generic call,
    // emitting `DeletedAt = Now();` — uncompilable C#.  The `softDelete` ops
    // macro is aggregate-level (pairs with the built-in `softDeletable`
    // capability for the state + filter).
    const files = await dotnetFiles(`
      context Sales {
        aggregate Order with softDeletable, softDelete {
          subject: string
        }
        repository Orders for Order { }
      }
    `);
    const order = files.get("Domain/Orders/Order.cs")!;
    expect(order).toMatch(/DeletedAt = DateTime\.UtcNow;/);
    expect(order).not.toMatch(/DeletedAt = Now\(\)/);
  });

  it("maps a nullable strongly-typed id field with a HasValue-guarded value converter", async () => {
    // Regression: a nullable id (`owner: User id?`, e.g. the `ownerStamped`
    // capability's `supersededBy: Self id?`) is an `optional` wrapping the id,
    // so it skipped the id-converter branch and got a bare `.HasColumnName`.
    // EF then can't map `UserId?` ("could not be mapped because the database
    // provider does not support this type") — it needs the converter.  The
    // struct-nullable form guards on HasValue (no `?.` — expression trees
    // reject it, CS8072).
    const files = await dotnetFiles(`
      context Sales {
        aggregate User { name: string }
        aggregate Order {
          subject: string
          owner: User id?
        }
        repository Orders for Order { }
        repository Users for User { }
      }
    `);
    const cfg = files.get("Infrastructure/Persistence/Configurations/OrderConfiguration.cs")!;
    expect(cfg).toContain(
      'builder.Property(x => x.Owner).HasConversion(v => v.HasValue ? v.Value.Value : (Guid?)null, v => v.HasValue ? (UserId?)new UserId(v.Value) : (UserId?)null).HasColumnName("owner");',
    );
    // Not the bare, converter-less mapping that fails EF model validation.
    expect(cfg).not.toMatch(/Property\(x => x\.Owner\)\.HasColumnName\("owner"\);/);
  });

  it("does NOT install HasQueryFilter for non-softDeletable aggregates", async () => {
    const files = await dotnetFiles(aggregateOnly(""));
    const cfg = files.get("Infrastructure/Persistence/Configurations/OrderConfiguration.cs")!;
    expect(cfg).not.toMatch(/HasQueryFilter/);
  });

  it("hand-written `filter` declaration installs the same way as macro-emitted", async () => {
    const files = await dotnetFiles(`
      context Sales {
        aggregate Order {
          subject: string
          archived: bool
          filter !this.archived
        }
        repository Orders for Order { }
      }
    `);
    const cfg = files.get("Infrastructure/Persistence/Configurations/OrderConfiguration.cs")!;
    expect(cfg).toMatch(/builder\.HasQueryFilter\("ArchivedFilter", x => !x\.Archived\)/);
  });

  it("names each filter so multiple capability filters are all additive (EF Core 10)", async () => {
    // Pre-EF-10 a second HasQueryFilter overwrote the first; named filters
    // make both apply.  The `softDeletable` capability filter + a hand-written
    // tenancy `filter` on the same aggregate ⇒ two distinct named calls.
    const files = await dotnetFiles(`
      context Sales {
        aggregate Order with softDeletable {
          subject: string
          tenantId: string
          filter this.tenantId == "acme"
        }
        repository Orders for Order { }
      }
    `);
    const cfg = files.get("Infrastructure/Persistence/Configurations/OrderConfiguration.cs")!;
    expect(cfg).toMatch(/builder\.HasQueryFilter\("IsDeletedFilter", x => !x\.IsDeleted\)/);
    expect(cfg).toMatch(/builder\.HasQueryFilter\("TenantIdFilter", x => x\.TenantId == "acme"\)/);
    // Two named filters, no accidental name collision.
    expect((cfg.match(/HasQueryFilter\(/g) ?? []).length).toBe(2);
  });
});

describe(".NET generator: registry-driven SaveChangesInterceptor", () => {
  it("emits AuditableInterceptor.cs when any aggregate has contextStamps", async () => {
    const files = await dotnetFilesWithAuth(withCaps("auditable"));
    const src = files.get("Infrastructure/Persistence/AuditableInterceptor.cs")!;
    expect(src).toMatch(/switch \(entry\.Entity\)/);
    expect(src).toMatch(/case Order /);
  });

  it("interceptor body assigns the macro-supplied fields via the EF lambda accessor", async () => {
    const files = await dotnetFilesWithAuth(withCaps("auditable"));
    const src = files.get("Infrastructure/Persistence/AuditableInterceptor.cs")!;
    // Compile-checked lambda write (capability-stamp-dedup) — keeps the stamped
    // property `private set` while the write stays bound to a real property.
    expect(src).toMatch(/ctx\.Entry\(e\)\.Property\(x => x\.CreatedAt\)\.CurrentValue =/);
    expect(src).toMatch(/ctx\.Entry\(e\)\.Property\(x => x\.UpdatedAt\)\.CurrentValue =/);
  });

  it("audit stamps render the now() builtin as DateTime.UtcNow (not a bogus Now() call)", async () => {
    // Regression: the audit macro built `now()` as a generic call, which
    // lowered to `Now()` — uncompilable C#.  It must build a NowExpr so the
    // .NET renderer emits the clock builtin.
    const files = await dotnetFilesWithAuth(withCaps("auditable"));
    const src = files.get("Infrastructure/Persistence/AuditableInterceptor.cs")!;
    expect(src).toMatch(
      /ctx\.Entry\(e\)\.Property\(x => x\.CreatedAt\)\.CurrentValue = DateTime\.UtcNow;/,
    );
    expect(src).toMatch(
      /ctx\.Entry\(e\)\.Property\(x => x\.UpdatedAt\)\.CurrentValue = DateTime\.UtcNow;/,
    );
    expect(src).not.toMatch(/= Now\(\)/);
  });

  it("Program.cs registers the interceptor when stamping is used", async () => {
    const files = await dotnetFilesWithAuth(withCaps("auditable"));
    const program = files.get("Program.cs")!;
    // The root namespace is the deployable's (`app` → `App`), not the context's.
    expect(program).toMatch(/AddScoped<App\.Infrastructure\.Persistence\.AuditableInterceptor>/);
  });

  it("softDeletable alone does NOT trigger interceptor emission", async () => {
    const files = await dotnetFiles(withCaps("softDeletable, softDelete"));
    expect([...files.keys()]).not.toContain("Infrastructure/Persistence/AuditableInterceptor.cs");
  });
});

describe(".NET generator: context-level propagation reaches per-config emission", () => {
  it("unqualified context-level filter propagates to every aggregate", async () => {
    const files = await dotnetFiles(`
      context Sales {
        filter !this.isDeleted
        aggregate Order {
          subject: string
          isDeleted: bool
        }
        aggregate Customer {
          name: string
          isDeleted: bool
        }
        repository Orders for Order { }
        repository Customers for Customer { }
      }
    `);
    expect(files.get("Infrastructure/Persistence/Configurations/OrderConfiguration.cs")!).toMatch(
      /builder\.HasQueryFilter\("IsDeletedFilter", x => !x\.IsDeleted\)/,
    );
    expect(
      files.get("Infrastructure/Persistence/Configurations/CustomerConfiguration.cs")!,
    ).toMatch(/builder\.HasQueryFilter\("IsDeletedFilter", x => !x\.IsDeleted\)/);
    const ctx = files.get("Infrastructure/Persistence/AppDbContext.cs")!;
    expect(ctx).not.toMatch(/foreach \(var entityType/);
  });
});

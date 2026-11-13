# D-EF-TPH-ROOT-READS — .NET EF reads every TPH concrete from its root, under root-hosted, type-guarded named filters

**Status:** applied (#3960, epic #3954).  Supersedes D-TPH-SUBTYPE-FILTER,
which declared a TPH subtype's filter over a subtype-only column a v1 limit of
the EF adapter (`loom.tph-filter-unsupported`), and the per-read `.Where`
successor it named (#3391).

**Question.** EF Core registers every query filter of an inheritance hierarchy
on the ROOT entity type.  How does the EF adapter apply a subtype's own
restriction — `softDeletable` on `Car`, a `filter this.seats > 0` reading a
column only `Car` has — on every read of that subtype, and on none of its
siblings'?

**Options.** (a) refuse the shape (the old gate); (b) drop the subtype filters
off the model onto a per-read LINQ `.Where` at each of ~30 emitter read sites;
(c) keep them on the model, hosted on the root and type-guarded, and read every
concrete from the root set.

**Decision.** (c).  A subtype's own filter is registered on the root config (a
principal one on `AppDbContext`) as `!(x is Car) || <pred over ((Car)x)>`,
named `Car_<Filter>` so two subtypes' filters keep distinct keys.  Every read of
a TPH concrete starts from the root: `_db.Vehicles.OfType<Car>()`.  `ignoring`
maps to `IgnoreQueryFilters([names])`, the root-hosted names included, and
never to the parameterless overload on a TPH participant.  The filters are
rendered from the `readScopeFor` fact (its `subtypeRestrictions` are exactly the
guarded set).  The polymorphic base read queries `DbSet<Base>`, where EF applies
every guard to the rows it governs.  TPC keeps `modelBuilder.Ignore<Base>()`.

**Rationale.**

- **It is EF's own mechanism, and it holds at runtime.**  Measured against EF
  Core 10.0.10 / Npgsql 10.0.3 on a real Postgres 17: by-id, list, paged
  (`Count` + `Skip`/`Take`), bulk by-ids, `Any`, tracked update, the base read
  and a projection over the base all apply the guarded filters;
  `IgnoreQueryFilters(["Car_…"])` before or after `OfType` lifts exactly that
  one; the tenant filter stays.  The SQL is the one a hand-written query would
  carry: `WHERE v."TenantId" = @t AND (v.kind <> 'Car' OR NOT v."IsDeleted") AND
  v.kind = 'Car'`.
- **The guard fails only over a sibling's own set** — `(Car)x` inside a filter
  applied to `DbSet<Truck>` cannot be built ("No coercion operator is defined
  between types 'Truck' and 'Car'").  So the `AppDbContext` exposes NO
  `DbSet<Concrete>` for a TPH concrete: a read naming one does not compile, and
  `test/generator/dotnet/dotnet-tph-capability-filter.test.ts` censuses every
  corpus hierarchy for one.
- **A model filter is enforced for every query, a per-read `.Where` only where
  an emitter put it.**  (b) would have traded a framework-enforced restriction
  for an emitter-enforced one across the adapter; a read path it missed is
  indistinguishable from success.  Under (c) the only read the emitter can get
  wrong is the query SOURCE, and that is a compile error.
- **Tenancy stays the DbContext's `_currentUser` field** — Microsoft's
  documented multi-tenancy pattern for query filters.

**Consequences.** `loom.tph-filter-unsupported`, its message and its register
row are deleted; `tph-crossings` and `inheritance-read-restrictions` generate
and pass on the dotnet behavioural leg, and `inheritance-base-reads` passes
there too.  The Dapper adapter is unaffected (it splices predicates into SQL)
and does not emit the TPH base reader, which queries the EF root set.

**Sources.** `src/generator/dotnet/ef-read-source.ts`,
`src/generator/dotnet/emit/efcore.ts` (`hostedQueryFilters`, `typeGuarded`),
`src/generator/dotnet/emit/base-reader.ts`, `src/ir/enrich/read-scope.ts`;
https://learn.microsoft.com/en-us/ef/core/querying/filters,
https://learn.microsoft.com/ef/core/modeling/inheritance.

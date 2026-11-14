# D-SEED-XREF — seed cross-references are explicit ids (no `@handle`)

**Status:** PINNED.

**Problem.** Declarative seed data sometimes needs to relate rows (an
`Order` referencing a `Customer`). How does a referencing row name the
referenced row's id?

**Decision.** **Explicit ids on the `raw` path** — the declarative-fixture
model of Django fixtures, EF Core `HasData`, and raw SQL. A `raw` row is a
literal record (explicit `id` + literal FK columns) inserted directly,
bypassing the domain `create`; the author writes the same literal id in the
referenced row and the referencing FK, and orders parents before children.
No bespoke handle/reference construct, no topological reorder.

A symbolic-reference form (`Customer @acme { … }` / `Order { customerId:
@acme }`, lowering to a `SeedRef` ExprIR + topo-sort) was prototyped and
**dropped**: no concrete stack has it (imperative seeders use host-language
local variables; declarative ones use explicit ids), it duplicates what the
imperative body's `let` bindings already give for free, and it spread a new
`ExprIR` variant + topo-sort + three validators across the toolchain for a
convenience neither camp felt the need to invent.

**Consequences.** The default **domain** path mints ids and therefore has no
cross-references (a minted id isn't knowable to reference) — flat demo /
reference data only. Cross-referenced / relational seed data uses **`raw`**.
`SeedRowIR` carries no `handle`; there is no `seed-ref` ExprIR; `SeedIR.rows`
stay in source order.

**Affects.** `database-seeding.md` §3.1/§3.2 (cross-ref design), §5 (IR), §8
(validation), §11 (build order — `raw` path is the cross-ref home).

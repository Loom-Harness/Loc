# D-POLYMORPHIC-ID-REPRESENTATION — a `<Base> id` to a TPC base is a plain id column: no FK, no discriminator

**Status:** applied — the proposed default took effect 2026-09-24 (merged to `main` 2026-09-22 in #2970; no override recorded by 2026-09-28; flipped by Wave C5 packet 5.0).
Owner mission **M-T5.7**; register row `loom.polymorphic-id-ref-unsupported`.

**Question.** `src/language/validators/inheritance.ts` rule 6 refuses a
`<Base> id` whose target is an abstract base with the TPC (`ownTable`) layout,
because "there is no single table to key the FK against". Before any backend
can emit it, the SCHEMA has to be decided — and the choice is visible in the
emitted DDL, so it is a ruling, not an implementation detail.

**Options.**
(a) a **polymorphic FK pair** — a `<field>_type` discriminator column beside
`<field>_id`, no referential integrity (Postgres cannot FK to a union of
tables); (b) **no FK, no discriminator** — one plain id column, resolved by the
DELEGATING polymorphic base reader that M-T5.7 already ships; (c) a `CREATE
VIEW` union over the per-concrete tables, read through the view.

**Decision.** **(b).** A `<Base> id` to a TPC base is an ORDINARY id column —
`uuid NOT NULL` plus its read index, no foreign key and no discriminator — and
the read resolves through the existing delegating base reader.

**Rationale — measured on this tree (wave C2 packet 2n), not reasoned.** The
completion plan proposed (a) as the default. The measurement argues for (b),
and it is worth stating why, because three of the pieces (a) would build turn
out to exist already:

- **The FK is ALREADY dropped, by a rule that predates this question.**
  `migrations-builder.ts` keeps a foreign key only when its target table exists
  in the same schema ("cross-context id references get NO foreign key",
  M-T4.4). A TPC base OWNS NO TABLE, so its FK fails that test and is filtered
  out automatically. Generated with rule 6 bypassed, node emits exactly the
  intended DDL with no code change at all: `"payment_id" UUID NOT NULL` and
  `CREATE INDEX "receipts_payment_id_idx"`, no `REFERENCES`.
- **The discriminator buys nothing, because ids are globally unique.**
  `lower.ts` assigns every aggregate `idValueType = "guid"`, so an id cannot
  collide across the concrete tables. And the reader that would consume a
  discriminator does not want one: `buildDelegatingBaseReaderFile`
  (`src/generator/typescript/base-reader-builder.ts`) resolves `findById` by
  trying each concrete repository in turn — which is also what loads each
  aggregate's FULL tree through its own capability filters, something a
  discriminator-directed single query would not do. Adding `(kind, id)` would
  add a column every writer must keep in step with the row it points at, for a
  lookup that does not read it.
- **(c) is strictly worse than (b) here.** A union view can only project the
  columns the concretes share, so it reads flat scalars and silently drops
  contained parts and `X id[]` associations — the exact trade the TPC base
  reader's own comment records rejecting.

**Consequences — what is left to build is SMALL, and it is not the schema.**
Generated with rule 6 bypassed, all five backends emit the reference column
correctly and `ddd generate` reports `0 error(s)`. The gap is two missing
IDENTITY TYPES:

| target | state with the gate bypassed |
|---|---|
| node | **correct** — `payment_id uuid`, index, no FK; `Ids.PaymentId` exists |
| python | **correct** — `PaymentId = NewType("PaymentId", str)` exists |
| elixir | **correct** — `field :payment_id, :binary_id`, no identity type needed |
| java | **breaks** — `Receipt.java` declares `@Embedded PaymentId paymentId` but no `PaymentId.java` is emitted: `src/generator/java/index.ts` skips an abstract TPC base (`if (agg.isAbstract && !isTphBase(...)) continue;`) |
| dotnet | **breaks** — `ReceiptConfiguration.cs` calls `new PaymentId(v)` with no `Domain/Ids/PaymentId.cs`: the same skip in `src/generator/dotnet/context-scaffolding-emit.ts` |

Both skips carry the comment "an abstract TPC base keeps no identity (each
concrete owns a typed id)", which was TRUE exactly while this reference was
refused. Lifting rule 6's `ownTable` arm therefore means emitting `<Base>Id`
for a TPC abstract base on those two — a value wrapper, not a schema change.

**Still open, and NOT settled by this ruling.** Whether FOLLOWING such a
reference works: the id-follow bulk load (`src/ir/util/id-follow.ts`) and a
query-time `projection … join <Base> as p on this.paymentId` were not
exercised, and they are the shapes most likely to need the base reader wired in
rather than a per-concrete repository. Rule 6's MIXED-strategy arm is also
entangled: with the `ownTable` arm removed, `loom.polymorphic-id-ref-mixed-strategy`
fires on a PURE TPC hierarchy (every concrete is `ownTable`, so every concrete
reads as an "override"), so its predicate has to narrow to a `sharedTable` base
in the same change.

**Sources.** `src/language/validators/inheritance.ts` rule 6;
`src/system/migrations-builder.ts` (the M-T4.4 FK filter);
`src/generator/typescript/base-reader-builder.ts`; `src/ir/lower/lower.ts`
(`idValueType = "guid"`); wave C2 packet 2n's hand-off note
([`docs/new-plan/waves/handoffs/wave-c2-2n-backends.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/new-plan/waves/handoffs/wave-c2-2n-backends.md)), which carries the
generated output the table above summarises.

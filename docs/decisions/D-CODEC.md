# D-CODEC — how a value is encoded on the wire, in a column, in memory and in a lineage comes from one IR fact

**Status:** PINNED (encodes RS-4, RS-12, RS-24, RS-37, RS-38, RS-42,
D-LONG-AVG-DEFAULTS, the owner ruling on #3527 and the four owner rulings on
#3593; fact landed for #3593 item 5).

**Question.** Each backend picked the encoding of `money`, `decimal`, the
integers and `datetime` itself, at each read path, column and lineage write.
So the same value reached the wire, the database or a provenance lineage in a
different form per backend (#3297, #3527, #3535, #3544, #3487, #3434).

**Decision.** One derived table, `src/ir/enrich/codec.ts`, owns those answers
per storable primitive, and `codecOf` resolves a declared type (optional,
collection, id, enum, value object) onto it:

- **Wire** (`WireEncoding`): `money` is a fixed-scale-4 decimal string with
  the RS-42 grammar; `decimal` is a float64 number; `int` / `long` are integers
  inside int32 / ±(2^53−1); `datetime` is ISO-8601 UTC at millisecond precision
  with no fraction on a whole second, truncated at ingress; `date` is
  `YYYY-MM-DD`.
- **Column** (`ColumnType`): `money` is `NUMERIC(19,4)`, `decimal` is
  unbounded, `datetime` is `timestamptz`, `File` is a JSONB reference. The
  migrations builder reads it.
- **Memory** (`MemoryHint`): what the in-memory value must hold exactly, and
  whether arithmetic is exact decimal.
- **Lineage** (`LineageEncoding`): every scalar is written in its wire
  encoding — `money` the RS-12 string (#3527), `decimal` the RS-24 number,
  `datetime` the RS-38 instant.
- **Channel envelope** (`envelopeInstantWire`): a `datetime` inside a channel
  (CloudEvents) envelope — its `time` and a datetime in `data` — and in a
  realtime frame is the RS-38 instant, because events cross deployables and
  backends.
- **Value object in a relational field** (`valueObjectStorage`): the flat
  `<field>_<member>` columns of the one shared migration are canonical. Each
  ORM maps them idiomatically; elixir regrouping them into a `:map` is its
  spelling of the same columns, not a divergence.

The owner decisions that completed the table are listed in `RULINGS`, each with
the RS-rule or decision it extends. `UNRULED` holds any open owner question;
no backend is moved onto a value for one. It is empty.

**Consequences.** The generator-layer numeric decision table
(`_numeric/codec.ts`) and `money-scale.ts` now derive from the fact. node/Hono
spells it in `src/generator/typescript/codec-spelling.ts` and
`numeric-codec.ts`, and `test/generator/hono/codec-census.test.ts` fails on a
scale, range bound, column factory, money grammar or ISO-8601 trim that a node
emitter chooses itself. python/FastAPI spells it in
`src/generator/python/codec-spelling.ts` and `numeric-codec.ts`, guarded the
same way by `test/generator/python/codec-census.test.ts` (SQLAlchemy column
types, money grammar and bounds, `.isoformat()`). .NET (EF Core and Dapper)
spells it in `src/generator/dotnet/codec-spelling.ts` and `numeric-codec.ts`,
guarded by `test/generator/dotnet/codec-census.test.ts` (Postgres column types,
money bound and grammar, the `yyyy-MM-dd` / `fff` formats, the `ToString("o")`
envelope time). java/Spring spells it in `src/generator/java/codec-spelling.ts`
and `numeric-codec.ts`, guarded by `test/generator/java/codec-census.test.ts`
(the `?::jsonb` casts, money scale, bound and grammar, the int range, the
`truncatedTo(MILLIS)` instant, `LocalDate` text, the `Instant.now().toString()`
envelope time); a lineage value goes through the emitted `ProvWire` helper.
elixir (plain Phoenix / Ecto) spells it in
`src/generator/elixir/vanilla/codec-spelling-ex.ts`, `numeric-codec.ts` and
`datetime-type-emit.ts` (the `Loom.Datetime` Ecto type, whose `wire/1` is the
instant's spelling), guarded by `test/generator/elixir/codec-census.test.ts`
(Ecto schema and migration types, the money bound, scale and grammar, the int
range, `to_iso8601` / `DateTime.truncate`, the Ecto datetime types). Every
backend is on the fact.

java/Spring renders the fact through `src/generator/java/wire-policy-java.ts`
(`test/generator/java/wire-policy-census.test.ts` is its census, with the
Jackson coercion table derived from `ingressFor`). Known java subject gap: the
still-referenced 409 detail reads `This resource is still referenced…` because
the shared advice does not know the aggregate.

.NET (EF and Dapper) renders it through `src/generator/dotnet/wire-policy-cs.ts`,
guarded by `test/generator/dotnet/wire-policy-census.test.ts`. A wrong-typed
JSON value (`"5"` for an `int`, `12.5` for a `money`) is a `field-invalid` 422 at
the field's pointer, as on node — not the 400 malformed-body answer it used to
get.
elixir/Phoenix renders the fact through `src/generator/elixir/wire-policy-ex.ts`
(`test/generator/elixir/wire-policy-census.test.ts` is its census). Ecto's
`cast/3` coerces across JSON types, so a controller plug (`require_wire_types`)
checks each int/long/decimal/money/bool request key's raw value against
`ingressFor` before the action runs; the key list is derived from the fact.

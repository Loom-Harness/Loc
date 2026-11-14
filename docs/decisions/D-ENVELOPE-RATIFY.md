# D-ENVELOPE-RATIFY — `X envelope` is a single-row find, not an `{id, ts, body}` carrier

**Superseded (2026-11-03):** with declared finds removed (#3951) the keyword had
no position where it meant anything but `T`, so it is removed — refused as
`loom.envelope-removed`, whose quick fix drops it (#4122).

**Status:** applied — the proposed default took effect 2026-09-13 (merged to `main` 2026-09-11 in #2863; no override recorded by 2026-09-28; flipped by Wave C5 packet 5.0).

**Question.** Does `find audit(): Order envelope` mean a wrapped
`{id, ts, body}` payload, a single-row read, or nothing at all until the carrier
is built?

**Options.** (L) build the `{id, ts, body}` carrier on all five backends — it
needs a `ts` source in the IR that nothing supplies; (M) ratify the single-row
meaning node and python already ship and drop the distinct carrier meaning;
(S) refuse `envelope` until it is built.

**Decision.** (M) — **`envelope` is arity sugar for a find that returns exactly
one row.** This diverges from the completion plan's proposed default (S, "refuse
until built"); the reason is in the Rationale, and PR
[#2852](https://github.com/Loom-Harness/Loc/pull/2852) is already open on `main`
taking this option.

**Rationale.**

- **A wrapper would contradict a PINNED decision.** D-ENVELOPE fixes every HTTP
  response to one of four shapes — bare value, `Paged<T>`, ProblemDetails,
  event-frame `{ kind, occurredAt, correlationId, data }`. An `{ id, ts, body }`
  wrapper is a fifth shape, and the event-frame is already the carrier for "an
  event plus its metadata".
- **Nothing supplies the carrier's own fields.** `GENERIC_SHAPES.envelope`
  (`src/ir/stdlib/generics.ts:74-77`) declares `{ id: string, ts: datetime,
  body: P }` and `monomorphizeGenericInstances` (`src/ir/enrich/enrichments.ts:1446-1458`)
  synthesizes an `OrderEnvelope` payload from it — but **no emitter has a single
  arm for the ctor**: `grep '"envelope"' src/` matches only the grammar, the
  `GenericCtorName` union and that shape table. Java and .NET render it
  structurally through their `TypeTarget` as `Envelope<T>`
  (`java/render-expr.ts:1007`, `dotnet/render-expr.ts:1221`); .NET declares the
  record exactly once (`dotnet/emit/common.ts:191`) and returns a bare `T` from a
  `Task<Envelope<T>>` signature (CS0029), java declares it **nowhere** (three
  references, zero definitions), elixir returns a JSON array. Building the
  carrier means inventing a `ts` value five times.
- **Refusal costs the same emitter surgery as ratification** and still leaves the
  grammar, the stdlib shape table and `docs/generators.md:66`'s five ticks
  promising a carrier no author can use. Zero `.ddd` in the repo uses the keyword
  (the reason every compile gate was blind), so ratification breaks no model
  either.

**Consequences.** `X envelope` means one row — the bare aggregate/payload wire
shape, 404 when absent. The `envelope` arm of `GENERIC_SHAPES` and its
monomorphized `<Arg>Envelope` payload go with the emitter change, or reduce to an
`envelopeReturn()` recogniser beside `pagedReturn`; leaving the `{id, ts, body}`
field list in the stdlib while no backend emits it is exactly the drift this
ruling removes. Java/.NET drop `Envelope<T>` from ports and impls (and delete the
now-dead record); elixir's find-controller reads and serialises ONE record
instead of `Repo.all`. A corpus fixture (`test/fixtures/corpus/envelope.ddd`)
enters the compile matrix in the same PR, because the gates cannot see the
carrier without one (rule 13). If a real event-envelope carrier is wanted later
it is a NEW ctor with a designed `ts` source, not this one.

**Unblocks.** M-T6.57 (P0) → wave **C1 packet 1c**; retires M-T6.14's DEBT-08
`envelope` deferral.

**Sources.** [`T6-backend-parity.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/new-plan/T6-backend-parity.md) M-T6.57 +
its 2026-09-09 fleet note (F57);
[`2026-09-03-language-docs-audit-findings.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/audits/2026-09-03-language-docs-audit-findings.md)
F21; PR #2852; `src/ir/stdlib/generics.ts`, `src/ir/enrich/enrichments.ts`,
`src/generator/{java,dotnet}/render-expr.ts`,
`src/generator/dotnet/emit/common.ts`.

# D-PYTHON-SINGLE-REALIZATION — python ships one realization, and that is not a gap

**Status:** PINNED (2026-09-13, wave C2 packet 2e).

**Question.** Ledger row `G2646-open-python-no-realization-axes` reads python's
absence from `src/platform/adapter-metadata.ts` as debt: `persistence:` and
`directoryLayout:` "offer no choice on that backend while node (drizzle/mikroorm)
and dotnet (EF/dapper) do". Sized **L**, unowned, and re-opened by every parity
sweep.

**Measured, on fresh `main`.** The asymmetry the row describes is not
python-vs-the-rest — it is *two adapters vs one*. `BACKEND_ADAPTER_METADATA`
lists `elixir` with exactly one persistence adapter (`ecto`) and `java` with
exactly one (`jpa`); neither offers a choice either. Three of five backends ship
a single realization. Python's only real difference is that it is ABSENT from the
mirror rather than present with a single-valued menu — and the file says that
absence is deliberate and matches the live surface (its `PlatformSurface` omits
`adapters()`).

**Decision.** **Python ships one realization — SQLAlchemy 2 async over asyncpg,
one directory layout — and that is a product statement, not an incomplete
implementation.** The row is re-classed `scope`. A second python persistence
adapter (Tortoise, Piccolo, raw asyncpg) is a T6-track *mission* to be minted
when a user need names the adapter, with the same bar every adapter carries: its
own pairwise cover cell, its own corpus compile leg, its own behavioural leg.
Nothing about the current state is silent — there is no gate to add, because
there is no `persistence:` value a user can write that python drops.

**Owner.** The T6 backend track, on demand. Not a completeness row, and not wave
C2's: no packet closes it by building, and leaving it `open` guarantees it is
re-derived by the next sweep.

**Consequences.** `G2646-open-python-no-realization-axes` moves out of the
ledger's `open` bucket. If python ever does grow a second adapter, the honest
first step is the `adapter-metadata.ts` entry (a single-valued menu, like java's
and elixir's), so the mirror stops being read as a completeness signal —
recorded here as the shape of that change, not scheduled.

**Sources.** `src/platform/adapter-metadata.ts` (`BACKEND_ADAPTER_METADATA`, and
its own note on python's absence); [`platforms.md`](../platforms.md);
[`docs/audits/targets-completeness-2026-08-30.ledger.json`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/audits/targets-completeness-2026-08-30.ledger.json).

# D-TIME-AS-EVENT — time enters as an infrastructure-emitted event (`timerSource`), not as a workflow trigger; the temporal surface is complete

**Status:** owner ruling, 2026-09-02.

**Decision.** `timerSource { for: <Event>, cron: | every: }` is the temporal
feature, and it ships on all five backends. A tick is a real event delivered
through the existing dispatcher, so it fans out to ordinary `on(e)` reactors
and `create(e) by` triggers and reuses saga state. There is no further temporal
sugar: timezone `in:`, `overlap: allow`, `missed:`/`retry:`, per-environment
cadence and saga-deadline sugar are not open work. `in:` and `overlap:` stay
parse-only under `loom.reserved-not-emitted`.

**Why.** Rejected alternatives: a `schedule every 5m { … }` workflow member
breaks the uniform `(params) by correlation` trigger grammar, gives a
stateless schedule a seat among instance-lifecycle members and bakes an
operational cadence into the domain; a system-scope `schedule { for:
<Workflow> }` needs a new paramless workflow entry shape, a bespoke trigger by
the back door; a structured `cadence:` pseudo-DSL ("daily at 02:00") lowered
to cron anyway and punted to raw cron for real cases. Cadence lives on the
infrastructure binding, so it can change per environment. The one new concept
is "infrastructure-emitted events".

**Consequence.** Explicit `cron:` (with `@daily`-style nicknames) and
`every:`; an `every:` that is cleanly cron-expressible is steered to `cron:`
(`loom.timer-cadence`). The timer owner is picked like `migrationsOwner`:
exactly one backend deployable. Re-open temporal surface only for a concrete
user need.

# D-KAFKA-START-OFFSET — a new kafka group starts at earliest on a work queue, latest on a log

**Status:** decided (owner ruling D3 of the 2026-09-28 eval-closure review,
item 13).

**Question.** Every backend's kafka consumer started a NEW consumer group at
the `latest` offset. On a work-queue channel (`delivery: queue` /
`retention: work`) that loses every event published before the consuming
deployable's group first joins — a fresh deploy whose producer boots first, or
a rejoin after the broker expired the group's offsets. The rabbit twin
(F-112) was fixed as a bug; kafka was not.

**Decision.** A new group on a work-queue channel starts at the **earliest**
offset; a `retention: log` (broadcast) channel keeps **latest**. A group with
committed offsets resumes from them in both cases, so this only decides the
first join. The predicate is `kafkaStartsAtEarliest`
(`src/generator/_channels/bindings.ts`); each backend reads it into its binding
row and passes it to the kafka driver only (node kafkajs `fromBeginning`, java
`AUTO_OFFSET_RESET_CONFIG`, .NET `AutoOffsetReset`, python
`auto_offset_reset`, elixir brod `begin_offset`). The other drivers have no
offsets and do not see it.

**Why.** `retention: work` promises a work item is delivered; a silent drop on
first boot breaks that promise. A replay of already-handled records is safe on
a work queue because consumers dedupe on the envelope id. On a log, a fresh
deployable replaying the whole history is a semantic change of its own
(the replay cursor, M-T4.2), so it stays out of this ruling.

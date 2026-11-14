# D-CHANNEL-KNOBS — one `channel` with orthogonal delivery × retention knobs, not topic/queue/stream keywords

**Status:** design ruling behind the shipped `channel` surface
([`channels.md`](../channels.md) documents the knobs).

**Decision.** One `channel` declaration with `delivery: broadcast | queue` ×
`retention: ephemeral | work | log` (the NATS JetStream model):
broadcast+ephemeral is pub/sub, broadcast+log a Kafka-style topic,
queue+ephemeral competing consumers, queue+work a durable work queue. The
channel contract never names a transport: a system-scope `channelSource` binds
it to a broker storage, and with no binding events stay on the in-process
dispatcher.

**Why.** Separate `topic`/`queue`/`stream` declarations triple the surface and
force a keyword change when a requirement changes (a broadcast topic that later
needs durability would become a different declaration). With orthogonal knobs a
requirement change flips a knob.

**Consequence.** `retention: log` plus a cursor is replay, which lines up with
`persistedAs: eventLog` and the appliers.

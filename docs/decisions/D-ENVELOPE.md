# D-ENVELOPE — the wire envelope rule

**Status:** PINNED. Full rules in
[`architecture/wire-envelope.md`](../architecture/wire-envelope.md).

**Decision.** Every HTTP response is exactly one of four shapes — **bare
value** (single entity/payload/primitive), **`Paged<T>`** (lists),
**ProblemDetails** (RFC 7807, all errors), **event-frame** (`{ kind,
occurredAt, correlationId, data }`). The HTTP **status code is the
success/error discriminator**; the success path is **never** wrapped in
a `{ kind: "ok", value }` envelope (D16) — the payload `type`
discriminator (D2/D3) lives inside tagged-union bodies, not at the
envelope level. A uniform `{ ok, value | error }` envelope is rejected
(forces every client to unwrap; duplicates the status line).

**Affects.** `payload-transport-layer.md`, `exception-less.md` (D16,
D17, D18), `pagination-design-note.md` (`Paged<T>`/`unpaged`),
`workflow-and-applier.md` (event-frame); every backend's DTO/route
emitter; the `conformance-parity.yml` OpenAPI gate.

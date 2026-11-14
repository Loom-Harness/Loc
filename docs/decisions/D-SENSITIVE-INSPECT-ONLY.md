# D-SENSITIVE-INSPECT-ONLY — `sensitive(...)` is a DECLARATION with one shipped consequence; wire masking is `mask unless`, and phases 2–4 are a commissioned mission

**Status:** applied — the proposed default took effect 2026-09-16 (merged to `main` 2026-09-14 in #2933; no override recorded by 2026-09-28; flipped by Wave C5 packet 5.0).
Raised by wave C2 packet 2f, which was asked to "build M-T3.8 phases 2–4, or
record the S alternative as a `scope` decision".

**Question.** `loom.sensitive-wire-unsupported` warns on every `sensitive(...)`
field a caller can actually receive: the tag reaches exactly one consequence
today (the synthesized `inspect` prints `<redacted>`), while the response DTO
carries the value in cleartext on all five backends and nothing classifies it at
a log / event / resource sink. It is a `gap` row in the register — the sprint
backlog. Is it one?

**Options.** (a) build phases 2–4 here: `authorized(<category>)` declassification,
wire `mask:` strategies in five DTO emitters, sink classification; (b) re-class
it `scope` with **M-T3.8** as the named successor, keeping the honest warning;
(c) rename the code out of the suffix — rule `sensitive` permanently a
documentation-and-`inspect` tag.

**Decision.** (b) — **`scope`, successor M-T3.8.** Not (c): the tag's name states
a wire promise a reader will assume, and the proposal it comes from specifies the
masking. Not (a) inside a per-target drain packet, for the reason below.

**Rationale.**

- **The row is HONEST already, and specific.** The warning names the one
  consequence that ships, states plainly that the field is serialized in
  cleartext to any caller allowed to read the aggregate, and gives two things
  that work TODAY: `mask unless <predicate>` (the per-caller read redaction,
  wired at the response boundary on all five) and `internal` / `secret` access
  (never served). So the author is not surprised, and the surface that redacts
  is not missing — it is a different surface, with a different meaning
  (`mask unless` is per-caller authorization; `sensitive` is a data-category
  classification).
- **Sensitivity is a field fact, not a type fact.** The tags live on
  `FieldIR.sensitivity` only — no `TypeIR` and no typing-pass `Ty` carries
  them, so no type relation, union key or type printer has to carry or ignore
  them, and there is no information-flow tracking through expressions (and so
  no "implicit conversion drops a tag" warning). The remaining work is
  field-level: wire masking strategies, and sink classification, where a log /
  emitted event / outbound resource call that receives a sensitive *field* is
  classified at the call.
- **The rest is two features, not one drain.** Wire masking is a per-strategy
  arm in five DTO emitters plus the OpenAPI schema that describes them; sink
  classification covers every log event, every emitted domain event's payload,
  every outbound resource call. Sink classification in particular has no
  chokepoint today: the `_obs/` catalog, the channel envelope and the resource
  clients each build their own payload.
- **Its failure mode is the one a sweep must not risk.** A masking arm applied
  at four of five response sites, or to the read DTO but not the audit snapshot
  (the exact asymmetry `mask unless` × `audited` hit on .NET, M-T3.9), is
  indistinguishable from success in every test that asserts by shape. It needs a
  booted acceptance per backend and a sink census — a mission's acceptance
  criteria, not a packet's.
- **`scope` is what the register means by this.** "A declared v1 limit with a
  named successor" — the limit is declared in the diagnostic, the successor
  exists and is sized L. Leaving it `gap` said the opposite: that a drain sprint
  could close it, which is how a security-shaped feature ends up half-ported by
  someone counting rows.

**Consequences.** The register row's `kind` becomes `scope` (it already names
`mission: "M-T3.8"`), and `MAX_OPEN_GAPS` drops by one. No emitter changes and no
message change — the warning keeps firing on every reachable `sensitive(...)`
field, which is the point. M-T3.8 keeps its `partial` status and its L size; this
tag is the reason its phases must land together rather than one emitter at a
time.

**Unblocks.** `loom.sensitive-wire-unsupported` → `scope` (wave **C2 packet 2f**);
M-T3.8 stays open and commissioned.

**Sources.** `src/ir/validate/checks/sensitivity-checks.ts`;
[`T3-security-governance.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/new-plan/T3-security-governance.md) M-T3.8;
[`sensitivity-and-compliance.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/proposals/sensitivity-and-compliance.md);
[`auth.md`](../auth.md) (`mask unless`).

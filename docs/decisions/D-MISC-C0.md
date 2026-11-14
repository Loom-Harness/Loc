# D-MISC-C0 — four small rulings that needed a name, not a debate

**Status:** applied — the proposed default took effect 2026-09-13 (merged to `main` 2026-09-11 in #2863; no override recorded by 2026-09-28; flipped by Wave C5 packet 5.0).

**Question.** Four rows whose proposed answers nobody disputes, but which no tag
records — so each is re-decided by whoever picks the row up.

**Decisions.**

1. **`generateDotnetForContexts` (M-T9.52).** The boundary **stays where M-T9.49
   drew it**: the ratchet gates the WRAPPER (`generateDotnet`), mirroring Hono's
   (which gates `generateHono`, not `generateTypeScriptForContexts`). Sequence
   M-T9.42's corpus promotion of `generator-dotnet.test.ts` FIRST — it is 66 of
   the 150 pinned .NET call sites and M-T9.42's largest single candidate, so
   doing it first shrinks this row by nearly half and shrinks the ratchet's pins
   in the same move. Re-measure the remaining direct `ForContexts` importers
   afterwards, and only then decide whether the rung below needs its own
   assertion. Verification is **two-sided** per M-T9.40 (re-seed the
   `enumName: undefined` mutation and report the count with AND without the new
   assertion) — a one-sided "N tests fail" number does not distinguish a working
   instrument from an unrelated string assertion.
2. **`connection:` on a `storage` (M-T7.9) — the two semantics.** *(a)*
   `service(x)` **names** a service the composer is already synthesising; it
   selects and labels, it does not create a second one, so `service(db)` and no
   clause at all describe the same topology and the declaration's only effect is
   on the emitted reference (the secret/env key). *(b)* Where the declared source
   **contradicts** the derived topology, **the declaration wins** and the
   composer emits what was declared — a heuristic that silently overrides an
   explicit author statement is unexplainable at the point of failure, and the
   current `Host=db;` classifier in `src/system/kubernetes.ts` is exactly such a
   heuristic. `literal("postgres://user:pass@…")` stays legal and keeps its
   warning (it is a real escape hatch for an already-public external endpoint);
   revisit only if a model needs it silenced.
3. **OpenAPI tag grouping (M-T6.13), decision (f).** Emit an explicit lowercase
   per-op `tags: ["<slug>"]` on **.NET and Java too**. They emit no explicit
   per-op tag today, so this is not a regression — it aligns them with the other
   three. Without it, Swashbuckle/springdoc default the per-op tag to the
   CONTROLLER name (`"Orders"`), which `x-tagGroups`'s `"orders"` reference does
   not match, so the feature would silently not group on exactly two of five
   backends. **Verify the default-tag value on a booted app**, not from the
   framework docs — the proposal itself flags the value as extrapolated
   (rule 12).
4. **`scopeId` (M-T3.11).** `scopeId` denotes the **business boundary** a frame
   belongs to; `parentId` denotes **call structure** ("who invoked me") — the two
   axes `execution-context.md` separates and that are easy to conflate. Loom pins
   the DEFAULT rather than leaving it to configuration: **one scope per inbound
   request, or per workflow RUN, whichever opened the outermost frame; a
   sub-workflow opens its own scope, a helper call does not.** Leaving it "to the
   system author" is what let five backends differ. Not author-configurable in
   v1. The ambient carrier keeps its D-CTX-SHAPE field set (`correlationId`,
   `scopeId`, `parentId`, plus `currentUser`/`locale`/`startedAt`); the genealogy
   detail (`operationId`, `nodeId`, `kind`, `timestamp`) stays on the emitted
   scope event.

**Rationale.** Each of the four has a recorded leaning that survived a
code-check, and none has a second defensible answer that anyone has argued for;
what they lack is a NAME, so each is re-litigated by the next agent to open the
row. Item 4 is the most judgement-laden of the four — the proposal explicitly
left it open — and is the one most worth an owner glance.

**Consequences.** Four mission bodies stop carrying an undecided fork. Item 1
imposes a SEQUENCE (M-T9.42's promotion before M-T9.52), which the C3 packet must
honour. Item 2 deletes the `storage-connection` row from `RESERVED_SURFACES` when
the wiring lands, and the k8s emitter's `Host=db;` classifier is replaced by the
declared source rather than extended.

**Unblocks.** M-T9.52 → wave **C3 packet 3d**; M-T7.9, M-T6.13 and M-T3.11 →
wave **C6**.

**Sources.** [`T9-toolchain-health.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/new-plan/T9-toolchain-health.md) M-T9.52;
[`T7-deployment-ops.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/new-plan/T7-deployment-ops.md) M-T7.9;
[`api-openapi-tag-grouping.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/proposals/api-openapi-tag-grouping.md)
§Open decisions (f);
[`T3-security-governance.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/new-plan/T3-security-governance.md) M-T3.11 and
[`execution-context.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/proposals/execution-context.md) §Open questions;
D-CTX-SHAPE.

# D-TARGET-RESERVED-NAMES — a member named like a target keyword, or a generated helper, is escaped per backend

**Status:** DECIDED (owner ruling D2, 2026-09-29 eval-closure review; implemented
by wave C2).

**Question.** A `.ddd` member, parameter, operation or enum value may be named
`def`, `lambda`, `pass`, `class` — the `.ddd` grammar admits them, `generate
system` answered `0 error(s)`, and the python project did not parse. A member
named `assertInvariants` broke .NET (CS0102), node (duplicate class member) and
python (a backing field overwriting its own method). Refuse such names with a
validator, or escape them per backend?

**Decision.** **Escape per backend; never refuse.** The target spelling is a
host concern and the user's domain vocabulary should not have to know five
languages' keyword lists.

- **Python** gets ONE identifier funnel (`pythonIdent` / `pythonWireIdent` in
  `src/util/naming.ts`, `def` → `def_`) at every identifier position, and keeps
  the two outward names: the DB column via `mapped_column("def", …)`, the wire
  key via a pydantic `alias` / `Query(alias=…)`. This mirrors Java's M-T6.36
  (`@JsonProperty` / `@Column`).
- **Node (Hono / TypeScript)** escapes through `escapeTsIdent` (`class` →
  `class_`, the strict-mode + module reserved set) at every BINDING position:
  operation / function / domain-service / VO-ctor / repository-find /
  criterion-fn / extern-hook / event-applier / projection-fold params, and the
  `const` locals the route, workflow and handler emitters bind. PROPERTY
  positions keep the declared name — `this._class`, `get class()`,
  `{ class: class_ }`, `schema.things.class`, the zod wire key — since any
  string is a legal TS property, so the wire and the DB column never move. The
  React / Vue / Svelte / Angular emitters bind no field name as an identifier
  (form state is keyed objects), so they needed no change.
- **.NET, node, python** rename the generated private invariant helper — and
  only when a member actually takes its name, so every other model's output is
  byte-identical (the conservative sub-choice: a fixed rename would have moved
  every generated entity on three backends for a collision that needs a
  specific member name).
- The wire, the OpenAPI document and the stored data never differ between
  backends; the escape is visible only in the generated host source.

**Consequences.** `test/fixtures/corpus/python-reserved-words.ddd` (row `ALL`)
is the ratchet on all five compile tiers and the wire-golden differential;
`test/generator/target-reserved-member-names.test.ts` takes the python keyword
list from the interpreter itself. The remaining unfunnelled python positions
(projection read models, the `auth.user` record) and the OTHER helper-state
collisions (`_events`, `pull_events`, `create`, `inspect` against a member of
that name) are recorded in `docs/generators.md` § "Names that are Python
keywords" as follow-ups — they fail loudly (a syntax/compile error), not
silently.

**Follow-up (2026-10-12).** The per-backend keyword sets became ONE
table with ONE escaping path, `src/util/target-identifiers.ts`
(`escapeTargetIdent` / `isReserved`, plus `escapeTargetMember` for names a
target reserves as a class member), and the ratchet widened from python to
every target: `test/fixtures/corpus/target-reserved-words.ddd` names a field,
an enum value, an operation and its parameter after every table word the
grammar admits, on all five compile legs.  The ruling is unchanged — escape,
never refuse.  See `generators.md` § "The per-target reserved-identifier
table".

**Sources.** the eval closure review (2026-09-28), item 6;
[`generators.md`](../generators.md) § "Names that are Python keywords" and
§ "Names that are Java reserved words".

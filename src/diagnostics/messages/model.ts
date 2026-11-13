// The `model` family of the diagnostic-message catalog: domain modeling: aggregates, entity parts, construction, containment, collections, value objects, inheritance and server-stamped fields.
//
// A code lives in the family that owns its first segment (`loom.<segment>-…`),
// listed in `segments` below; `../messages.ts` merges every family into
// `DIAGNOSTIC_MESSAGES`, and `test/system/diagnostic-catalog.test.ts` fails on a
// key filed under the wrong family.  A code with a brand-new first segment adds
// that segment to the family it belongs with.

import { didYouMean, type MessageEntry } from "./_shared.js";

/** The code first-segments this family owns. */
export const segments = [
  "create",
  "entity",
  "aggregate",
  "abstract",
  "polymorphic",
  "tph",
  "extends",
  "inheritance",
  "containment",
  "valueobject",
  "unconstructible",
  "construction",
  "provenanced",
  "stamp",
  "softdelete",
  "crudish",
  "update",
  "dunder",
  "reserved",
  "enum",
  "id",
  "this",
  "self",
  "member",
  "property",
  "derived",
  "es",
] as const;

export const messages = {
  // ----------------------------------------------------------------------
  // src/language/validators/builder-call.ts
  // ----------------------------------------------------------------------
  "loom.construction-missing-field": (p: { type: unknown; length: unknown; missing: unknown }) =>
    `'${p.type}' construction is missing required field${p.length}: ${p.missing}.`,
  "loom.create-server-field": (p: { name: unknown; name2: unknown; serverOwned: unknown }) =>
    `'${p.name}.create' can't set '${p.name2}' — it's a server-owned (${p.serverOwned}) field, ` +
    `populated automatically and absent from the factory input. Remove it.`,
  "loom.create-unknown-field": (p: {
    name: unknown;
    name2: unknown;
    size: unknown;
    createInput: unknown;
    suggestion?: unknown;
  }) =>
    `'${p.name}' has no create-input field '${p.name2}'.` +
    didYouMean(p.suggestion) +
    (p.size ? ` Create inputs: ${p.createInput}.` : ""),
  "loom.create-field-type": (p: {
    name: unknown;
    name2: unknown;
    expFam: unknown;
    expected: unknown;
    actual: unknown;
  }) =>
    `'${p.name}.create' field '${p.name2}' expects a ${p.expFam} value ('${p.expected}') but got '${p.actual}'.`,
  "loom.create-field-type#nullable": (p: {
    name: unknown;
    name2: unknown;
    expected: unknown;
    actual: unknown;
    src: unknown;
  }) =>
    `'${p.name}.create' field '${p.name2}' expects '${p.expected}' but got '${p.actual}' — a ` +
    `nullable value is not usable where a non-null one is required, and a \`requires\` / ` +
    `\`precondition\` null test does not narrow it. Narrow it at the use with a ternary on ` +
    `the same path (\`${p.src} != null ? ${p.src} : <fallback>\`) or \`${p.src} ?? <fallback>\`, ` +
    `take the value as a non-optional parameter, or declare '${p.name2}' optional.`,
  "loom.create-field-type#null": (p: { name: unknown; name2: unknown; expected: unknown }) =>
    `'${p.name}.create' field '${p.name2}' expects '${p.expected}' but got 'null' — the field ` +
    `is not optional. Pass a value, or declare '${p.name2}' optional.`,
  "loom.create-field-id-target": (p: {
    name: unknown;
    name2: unknown;
    expected: unknown;
    actual: unknown;
  }) =>
    `'${p.name}.create' field '${p.name2}' expects '${p.expected}' but got '${p.actual}' — a ` +
    `reference to a different aggregate. A create call is the wire boundary, so a plain string ` +
    `is accepted where an id is expected (that is how an id arrives as JSON), but two ids of ` +
    `different aggregates are not interchangeable: this would persist a row pointing at the ` +
    `wrong table. Pass the '${p.expected}' — the id of the aggregate the field references.`,
  "loom.aggregate-not-constructible": (p: { name: unknown }) =>
    `No code path can create a '${p.name}': it declares no 'create' (and no ` +
    `'with crudish'), no workflow or commandHandler builds one, and it is not ` +
    `seeded or event-sourced. Its table can only ever be empty, so 'POST' is ` +
    `405 and every read over it returns nothing. Add a 'create', give it ` +
    `'with crudish', or say in a comment that it is populated out of band.`,
  "loom.aggregate-not-a-builder": (p: { name: unknown }) =>
    `'${p.name}' is an aggregate — construct it with '${p.name}.create(…)', not '${p.name} { … }'. ` +
    `The '{ }' builder literal is for value objects and entity parts.`,

  // ----------------------------------------------------------------------
  // src/language/validators/duplicates.ts
  // ----------------------------------------------------------------------
  "loom.member-name-collision": (p: {
    what: unknown;
    name: unknown;
    owner: unknown;
    first: unknown;
  }) =>
    `${p.what} '${p.name}' in ${p.owner} reuses the name of the ${p.first} declared before it. An aggregate or ` +
    `entity part has ONE member namespace — fields, derived fields, containments, functions and operations share it — ` +
    `and the node, python and .NET classes put them all in one class body, where the second declaration ` +
    `hides or duplicates the first (TS2300 / CS0102). Rename one of them.`,

  // ----------------------------------------------------------------------
  // src/language/validators/generics.ts
  // ----------------------------------------------------------------------
  "loom.self-outside-capability":
    "`Self id` is only valid inside a `capability` body (it resolves to the " +
    "implementing aggregate's type). Use a concrete `<Aggregate> id` here.",

  // ----------------------------------------------------------------------
  // src/language/validators/inheritance.ts
  // ----------------------------------------------------------------------
  "loom.extends-self": (p: { name: unknown }) => `Aggregate '${p.name}' cannot extend itself.`,
  "loom.extends-non-abstract": (p: { name: unknown; baseName: unknown }) =>
    `Aggregate '${p.name}' extends '${p.baseName}', which is not abstract. ` +
    `Only an 'abstract aggregate' may be extended.`,
  "loom.inheritance-modifier-misplaced": (p: { inheritanceUsing: unknown; name: unknown }) =>
    `'inheritanceUsing(${p.inheritanceUsing})' is only valid on an 'abstract' base ` +
    `or an 'extends' subtype; '${p.name}' is neither.`,
  "loom.abstract-aggregate-behavior": (p: { name: unknown; kw: unknown }) =>
    `Abstract aggregate '${p.name}' cannot declare a '${p.kw}' action — abstract ` +
    `bases are never instantiated and have no polymorphic dispatch in v1. ` +
    `Declare it on each concrete subtype.`,
  // A containment graph must be a tree: an aggregate is loaded whole, so a part
  // that contains itself names a value with no finite serialisation.  The
  // message carries the CHAIN because a two-part cycle is obvious and a
  // three-part one is not, and it names the shape that does work — the natural
  // domains here (sub-task tree, bill of materials, threaded comment) are ones
  // an author will want to model some other way, not abandon.
  "loom.containment-cycle": (p: { agg: unknown; chain: unknown; part: unknown }) =>
    `Aggregate '${p.agg}' has a containment cycle: ${p.chain}. An aggregate is loaded as a ` +
    `whole, so a part that contains itself (directly or through a chain) has no finite shape. ` +
    `Model the recursion as a separate aggregate with a self-reference instead — ` +
    `'aggregate ${p.part} { parentId: ${p.part} id? … }' is a foreign key to the same table and ` +
    `loads one level at a time.`,
  "loom.abstract-aggregate-contains": (p: { name: unknown; member: unknown }) =>
    `Abstract aggregate '${p.name}' cannot declare 'contains ${p.member}' — an abstract ` +
    `base owns no repository and its concretes do not inherit its parts, so the part's ` +
    `table would have no reader and no writer. Declare the containment on each concrete ` +
    `subtype instead.`,
  "loom.es-tph-forced-own-table": (p: { name: unknown; why: unknown; baseName: unknown }) =>
    `'${p.name}' is ${p.why} but extends the sharedTable (TPH) base '${p.baseName}'. ` +
    `An event-sourced / document / embedded concrete cannot share the base table — declare ` +
    `'inheritanceUsing: ownTable' on '${p.name}'.`,
  "loom.tph-own-override-unsupported": (p: { name: unknown; baseName: unknown }) =>
    `'${p.name}' declares inheritanceUsing: ownTable under the sharedTable (TPH) base ` +
    `'${p.baseName}' — a per-concrete storage override (mixed strategy) is not supported ` +
    `yet. The override concrete would live in its own table, outside the shared one, so ` +
    `'find all ${p.baseName}' and polymorphic '${p.baseName} id' references can't see it. ` +
    `Make '${p.name}' sharedTable to keep the whole hierarchy in one table, or make ` +
    `the entire hierarchy ownTable (TPC).`,
  "loom.extends-cycle": (p: { names: unknown; names2: unknown }) =>
    `Aggregate '${p.names}' is part of an 'extends' cycle: ` +
    `${p.names2}. Inheritance must form a chain, not a loop — ` +
    `break the cycle so one abstract base sits at the top.`,
  "loom.abstract-repository": (p: { name: unknown; targetName: unknown }) =>
    `'repository ${p.name} for ${p.targetName}': '${p.targetName}' is an abstract ` +
    `aggregate and has no repository of its own. Repositories belong to concrete subtypes.`,
  "loom.polymorphic-id-ref-unsupported": (p: { name: unknown }) =>
    `'${p.name} id' references the abstract base '${p.name}', which uses ` +
    `inheritanceUsing: ownTable (TPC) — there is no single table to key against, so the ` +
    `foreign-key target is ambiguous across the per-concrete tables. Reference a concrete ` +
    `subtype's id (e.g. 'Customer id'), or change '${p.name}' to ` +
    `inheritanceUsing: sharedTable (TPH) to allow polymorphic references.`,
  "loom.polymorphic-id-ref-mixed-strategy": (p: { name: unknown; names: unknown }) =>
    `'${p.name} id' references the abstract base '${p.name}', but its hierarchy mixes ` +
    `storage strategies: ${p.names} override(s) to inheritanceUsing: ownTable and live in a ` +
    `separate table, so a polymorphic '${p.name} id' would silently miss them. Reference ` +
    `a concrete subtype's id instead, or make every concrete sharedTable (TPH) so the ` +
    `whole hierarchy shares one table.`,

  // ----------------------------------------------------------------------
  // src/language/validators/statements.ts
  // ----------------------------------------------------------------------
  "loom.this-id-in-create": (p: { name: unknown }) =>
    `Cannot read 'this.id' inside the create action on aggregate '${p.name}' — the id is not assigned until persistence, after the body runs.`,
  "loom.construction-field-type": (p: {
    name: unknown;
    type: unknown;
    expected: unknown;
    actual: unknown;
  }) => `Field '${p.name}' of '${p.type}' expects '${p.expected}' but got '${p.actual}'.`,

  // --- the M-T9.56 drain of `statements.ts` -------------------------------
  "loom.member-not-callable": (p: { member: unknown }) =>
    `Member '${p.member}' is not callable — only operations and functions can be called.`,

  // ----------------------------------------------------------------------
  // src/language/validators/structural.ts
  // ----------------------------------------------------------------------
  // --- the M-T9.56 drain of `structural.ts` -------------------------------
  "loom.valueobject-contains-entity": "Value objects cannot contain entities.",
  "loom.containment-optional-collection": (p: { name: unknown }) =>
    `Containment '${p.name}' is both a collection and optional — an empty collection already encodes absence; drop the '?'.`,
  "loom.containment-foreign-part": (p: { name: unknown; owner: unknown }) =>
    `Cannot 'contain' part '${p.name}' — it belongs to aggregate '${p.owner}'. Use '${p.owner} id' for a cross-aggregate link.`,
  "loom.containment-cycle#ast": (p: { cycle: unknown; name: unknown; target: unknown }) =>
    `Cyclic containment in aggregate '${p.name}': ${p.cycle}. ` +
    `'contains' is ownership, so an aggregate's parts must form a tree — a cycle can be neither loaded nor persisted ` +
    `(every backend's eager-load walks 'contains' recursively). ` +
    `Break the loop: drop this containment, or reference the other aggregate's root with '<Aggregate> id' instead of containing '${p.target}'.`,
  "loom.id-target-not-identity": (p: { name: unknown; kind: unknown; hint: unknown }) =>
    `'${p.name} id' names ${p.kind} '${p.name}', which has no identity — only aggregates and entity parts carry an id. ` +
    `Reference an aggregate or an entity part instead${p.hint}.`,
  "loom.provenanced-never-written": (p: { name: unknown; aggName: unknown }) =>
    `Provenanced field '${p.name}' on aggregate '${p.aggName}' is never written; no trace records will be produced.`,
  "loom.provenanced-part-field": (p: { name: unknown; partName: unknown; aggName: unknown }) =>
    `Field '${p.name}' of entity '${p.partName}' cannot be provenanced: lineage is recorded only for fields of the aggregate root '${p.aggName}'. Move the field onto '${p.aggName}', or drop 'provenanced'.`,
  "loom.entity-field-modifier": (p: {
    name: unknown;
    label: unknown;
    modifier: unknown;
    array: unknown;
  }) =>
    `Field '${p.name}' contains entity '${p.label}', so '${p.modifier}' does not apply — ` +
    `it is only valid on value properties. Drop it (write 'contains ${p.name}: ${p.label}${
      p.array
    }' if you want the keyword explicit).`,
  // Reserved derived names are aggregate-only — a value object participates in
  // neither `string(x)` lowering nor host-language `ToString()`/`Inspect`
  // emission, so `derived display` on one has nowhere to go.
  "loom.reserved-derived-on-vo": (p: { name: unknown }) =>
    `Reserved 'derived ${p.name}' is only allowed on aggregates, not value objects.`,
  "loom.entity-field-optional-collection": (p: { name: unknown; label: unknown }) =>
    `Field '${p.name}' contains entity '${p.label}' as both a collection and optional — ` +
    `an empty collection already encodes absence; drop the '?'.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/member-resolution-checks.ts
  // ----------------------------------------------------------------------
  "loom.member-unresolved": (p: { member: unknown; shape: unknown; known: unknown }) =>
    `'${p.member}' is not a member of '${p.shape}' (it has: ${p.known}). ` +
    `The type checker could not see the receiver's type here, so this was not caught earlier. ` +
    `Name a declared member, or bind the receiver with an explicit type.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/structural-checks.ts
  // ----------------------------------------------------------------------
  "loom.valueobject-shadows-root": (p: { name: unknown; voName: unknown }) =>
    `context '${p.name}' declares value object '${p.voName}' that shadows the root-level declaration; rename one of them.`,
  "loom.enum-shadows-root": (p: { name: unknown; eName: unknown }) =>
    `context '${p.name}' declares enum '${p.eName}' that shadows the root-level declaration; rename one of them.`,

  // --- M-T5.34 / #2864 D6, decision D-2 -----------------------------------
  // An entity-PART-typed parameter on a public action.  The materialization
  // step has a value-object arm (`new LineVO(e.sku, e.qty)`) and no entity arm,
  // so node emits `z.array(z.unknown())` + an identity map (no wire contract at
  // all; `save()` then reads `child.id` / `child.parentId` as `undefined`) and
  // dotnet / java / python do not compile (`List<LineResponse>` -> `List<Line>`).
  //
  // REJECTED rather than materialized, because materializing it means answering
  // a question the DSL has never answered: does a client-supplied part REPLACE
  // the collection (new ids, orphaning history) or MERGE by id?  That is a
  // language decision for a proposal, not a guess inside an emitter.  The value
  // object is the right advice anyway — a part the client hands you whole has no
  // identity of its own, which is the definition of a value object (a `Leg` in
  // an itinerary is a value object in Evans' own model).
  //
  // Scope, each boundary verified rather than assumed: PUBLIC actions only (a
  // `private` operation never crosses the wire, so it emits no contract and has
  // no defect), and NOT the `create` position (a declared create's parameter
  // list is not the request contract — the create input is derived from the
  // aggregate's fields, where a containment already emits `<Part>Response`
  // correctly).
  "loom.entity-part-param-unsupported": (p: {
    name: unknown;
    opName: unknown;
    param: unknown;
    part: unknown;
    collection: unknown;
  }) =>
    `'${p.name}.${p.opName}' takes '${p.param}', typed on the entity part '${p.part}'. ` +
    `A client-supplied entity part has no wire materialization on any backend: node emits an ` +
    `uncontracted 'z.unknown()' and dotnet/java/python don't compile. Declare '${p.part}' as a ` +
    `'valueobject' instead of an 'entity' — the value-object form IS emitted correctly` +
    `${p.collection ? ", and a replace-the-whole-collection write is exactly value-object semantics" : ""}. ` +
    `An entity part is identity-bearing, so passing one in raises a question the language has ` +
    `not settled — whether the supplied parts REPLACE the collection (new ids, history ` +
    `orphaned) or MERGE by id — which is why this is refused rather than guessed at.`,
  "loom.reserved-structural-error-name": (p: { name: unknown }) =>
    `error '${p.name}' collides with a built-in structural-conflict name. ` +
    `That name is reserved: its HTTP status defaults to 409 and a ` +
    `\`httpStatus ${p.name} -> <code>\` line retargets the framework conflict, not ` +
    `just this payload. Rename the error to avoid the shadow.`,

  // ----------------------------------------------------------------------
  // src/language/validators/types.ts
  // ----------------------------------------------------------------------
  // --- the M-T9.56 drain of `types.ts` ------------------------------------
  "loom.property-check-not-bool": (p: { name: unknown; actual: unknown }) =>
    `Property check on '${p.name}' must be of type 'bool', got '${p.actual}'.`,
  // The field and the parameter default stay TWO codes: the wording names the
  // declaration kind, and a fix-hint for one ("move it into `create`") makes no
  // sense for the other.
  "loom.property-default-type-mismatch": (p: {
    name: unknown;
    actual: unknown;
    declared: unknown;
  }) => `Default for '${p.name}' has type '${p.actual}' but the field is declared '${p.declared}'.`,
  "loom.derived-type-mismatch": (p: { name: unknown; actual: unknown; declared: unknown }) =>
    `Derived '${p.name}' has expression of type '${p.actual}' but declared type is '${p.declared}'.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/capability-checks.ts
  // ----------------------------------------------------------------------
  // F-017 — a server-owned field that nothing ever writes.  Named for the
  // MODEL property (the aggregate cannot be constructed), not for the
  // per-backend symptom, which differs on all five.
  "loom.unconstructible-server-field": (p: { agg: unknown; field: unknown; access: unknown }) =>
    `aggregate '${p.agg}' cannot be created: field '${p.field}' is '${p.access}', so it is not on ` +
    `the create input, but nothing writes it — it has no '= <default>' and no lifecycle stamp. ` +
    `Every create would leave it unset (a null into a NOT NULL column). ` +
    `Give it a default ('${p.field}: … = <expr>'), stamp it ('stamp onCreate { ${p.field} := … }'), ` +
    `or make it optional ('${p.field}: …?').`,
  "loom.stamp-read-before-flush#aggregate-create-reads": (p: {
    name: unknown;
    cName: unknown;
    createStampFields: unknown;
  }) =>
    `aggregate '${p.name}' create '${p.cName}' reads an audit stamp field ` +
    `(${p.createStampFields}) that 'with auditable' only populates at persist time. ` +
    `The value is unset while the create body runs (it lands when the unit of work flushes). ` +
    `Remove the in-body read, or compute the value explicitly instead of relying on the audit stamp.`,
  "loom.stamp-read-before-flush#aggregate-operation-reads": (p: {
    name: unknown;
    opName: unknown;
    updateStampFields: unknown;
  }) =>
    `aggregate '${p.name}' operation '${p.opName}' reads an audit stamp field ` +
    `(${p.updateStampFields}) that 'with auditable' updates only at persist time. ` +
    `The new value is not applied until this operation's unit of work flushes, so the body would ` +
    `observe the prior value. Remove the in-body read, or compute the value explicitly.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/update-gate-suggestion-checks.ts
  // ----------------------------------------------------------------------
  "loom.update-gate-suggestion": (p: {
    name: unknown;
    fName: unknown;
    opName: unknown;
    gate: unknown;
    hasDefault: unknown;
  }) =>
    `'${p.name}.${p.fName}' is assigned by '${p.opName}', which is gated by ${p.gate === "when" ? `its 'when' state gate` : p.gate === "precondition" ? `a 'precondition' on '${p.fName}'` : `'requires'`}, but 'crudish' also exposes the field on its generic 'update' — a caller can set it there and skip that gate. ` +
    `Mark it 'immutable' to take it off the update input ('${p.opName}' can still assign it).` +
    (p.gate === "requires"
      ? ""
      : p.hasDefault
        ? ` 'create' still accepts it too, so a client can start an instance in any state; if every instance must start at the default, mark it 'managed' instead (off create and update, initialised from the default).`
        : ` 'create' still accepts it too, so a client can start an instance in any state; give it a default and mark it 'managed' if the initial state must not be client-chosen.`),

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/crudish-hard-delete-checks.ts
  // ----------------------------------------------------------------------
  "loom.crudish-hard-delete": (p: { name: unknown }) =>
    `'${p.name}' is 'softDeletable', but the 'destroy' that 'crudish' emits is a HARD delete: 'DELETE /{id}' removes the row, it does not set 'isDeleted'. To make soft delete the only way out, write 'with crudish(updateOnly: true), softDeletable, softDelete' (and declare the 'create' you still want) — the soft delete is then 'POST /{id}/soft_delete'. Keep 'crudish' as it is if a physical delete (an admin purge, an erasure request) is what you mean.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/ui-framework-checks.ts — the two LiveView
  // component-HOISTING collisions (§18 emitter sentinels).  Both used to be a
  // bare `throw new Error` in `liveview-emit.ts`, raised mid-generate on a
  // `.ddd` that had just validated `0 error(s), 0 warning(s)`.
  // ----------------------------------------------------------------------
  "loom.create-call-not-constructible": (p: { agg: unknown; blocking: unknown }) =>
    `\`${p.agg}.create(…)\` calls a factory that does not exist: '${p.agg}' is NOT CONSTRUCTIBLE, ` +
    `so every backend deliberately emits no \`create\`.${p.blocking}  ` +
    `An aggregate is constructible only when every invariant can be satisfied from the create input alone; ` +
    `one that reads containments, managed fields or post-create state cannot be built by a plain create. ` +
    `Build it through an explicit \`create(...)\` action (or \`with crudish\`), or relax the invariant to the create payload. ` +
    `Left alone this emits \`${p.agg}.create(...)\` against a class that has none — the generated project fails its own compiler.`,
  "loom.create-call-missing-field": (p: {
    agg: unknown;
    missing: unknown;
    plural: unknown;
    input: unknown;
  }) =>
    `\`${p.agg}.create(…)\` omits ${p.missing}, which ${p.plural} REQUIRED create input. ` +
    `The factory input is the field-derived create-input contract, not the arguments the call happens to pass: ` +
    `${p.input}.  A field is omittable only when it is optional, carries an \`= default\`, or has a ` +
    `language-defined implicit default (a bare \`bool\`). Supply it, give it a default, or make it optional.`,
  // A declared `create(…)`'s parameter list is the create input, so each
  // param must BE a client-suppliable field.
  "loom.create-param-not-a-field": (p: { agg: unknown; param: unknown; fields: unknown }) =>
    `Aggregate '${p.agg}': \`create\` parameter '${p.param}' names no field.  A declared ` +
    `\`create(…)\`'s parameters ARE the \`POST /<plural>\` request contract — each one is ` +
    `the wire slot of the same-named field, so a free-standing parameter has nowhere to ` +
    `land.  Rename it to one of ${p.fields}, or declare the field.`,
  "loom.create-param-not-a-field#server-owned": (p: {
    agg: unknown;
    param: unknown;
    access: unknown;
  }) =>
    `Aggregate '${p.agg}': \`create\` parameter '${p.param}' names a \`${p.access}\` field, ` +
    `which the server owns — a client cannot supply it at creation.  Drop it from the ` +
    `parameter list (its declared default initialises it), or remove the \`${p.access}\` modifier.`,
  "loom.create-param-not-a-field#type": (p: { agg: unknown; param: unknown }) =>
    `Aggregate '${p.agg}': \`create\` parameter '${p.param}' does not have the type of the ` +
    `field '${p.param}' (including its \`?\`).  The parameter is that field's wire slot, so ` +
    `declare it with the field's exact type.`,
  // A field a narrowed `create(…)` leaves out must be one the factory can
  // initialise on its own.
  "loom.create-param-required-omitted": (p: { agg: unknown; field: unknown }) =>
    `Aggregate '${p.agg}': the declared \`create(…)\` leaves out '${p.field}', which is ` +
    `required — non-nullable, with no default.  A declared parameter list IS the request ` +
    `contract, so nothing would give '${p.field}' a value at creation.  Add it to the ` +
    `parameters, give the field an \`= <default>\`, or make it optional (\`${p.field}: T?\`).`,
  "loom.create-param-required-omitted#default": (p: { agg: unknown; field: unknown }) =>
    `Aggregate '${p.agg}': the declared \`create(…)\` leaves out '${p.field}', whose default ` +
    `is not a compile-time constant (a literal or an enum member).  A field outside the ` +
    `parameter list is initialised by the domain factory, which has no clock, principal or ` +
    `constructor context to evaluate that default in.  Add '${p.field}' to the parameters, ` +
    `or give it a constant default.`,
  "loom.dunder-field-name": (p: {
    what: unknown;
    owner: unknown;
    name: unknown;
    ctxName: unknown;
  }) =>
    `'${p.ctxName}.${p.owner}' declares the field '${p.name}', a '__name__'-shaped identifier ` +
    `the generated runtimes reserve: Elixir refuses '__struct__' in a struct definition and ` +
    `Ecto already defines '__meta__' on every schema (the Phoenix project fails to compile), ` +
    `and Python's pydantic does not treat a dunder annotation as a field at all (the FastAPI ` +
    `project drops it from every request). Rename the ${p.what} field — e.g. ` +
    `'${String(p.name).replace(/^_+|_+$/g, "")}Info'.`,
  "loom.stamp-principal-without-auth": (p: {
    dep: unknown;
    family: unknown;
    ctxName: unknown;
    name: unknown;
    principalNoun: unknown;
  }) =>
    `Deployable '${p.dep}' (platform ${p.family}) hosts aggregate '${p.ctxName}.${p.name}' ` +
    `with a lifecycle stamp that references currentUser (e.g. \`createdBy := currentUser\` ` +
    `from \`with audit\`), but the deployable has no auth — there is no request-scoped ` +
    `${p.principalNoun} to stamp from. Add 'auth: required' (and a system 'user {}' block), or use ` +
    `non-principal stamps (e.g. \`stamp onCreate { createdAt := now() }\`).`,
  "loom.stamp-on-event-sourced-invalid": (p: {
    dep: unknown;
    family: unknown;
    ctxName: unknown;
    name: unknown;
  }) =>
    `Deployable '${p.dep}' (platform ${p.family}) hosts event-sourced aggregate ` +
    `'${p.ctxName}.${p.name}' with a lifecycle stamp (a \`stamp onCreate\` / \`onUpdate\` ` +
    `assignment such as \`createdAt := now()\`) — stamps mutate state fields, but an ` +
    `event-sourced aggregate's state is folded from its event stream. ` +
    `Record the value in an event instead, or drop persistedAs: eventLog.`,
  "loom.stamp-reads-aggregate-unsupported": (p: {
    dep: unknown;
    family: unknown;
    ctxName: unknown;
    name: unknown;
    field: unknown;
  }) =>
    `Deployable '${p.dep}' (platform ${p.family}) hosts document-shaped aggregate ` +
    `'${p.ctxName}.${p.name}' whose lifecycle stamp of '${p.field}' reads the aggregate itself ` +
    `(a field, derived value or function of '${p.name}'). This backend merges a document ` +
    `aggregate's stamps into the request attributes before any record exists, so there is ` +
    `nothing to evaluate the value against. Compute the value in the create/operation body ` +
    `instead, keep the stamp to values that do not read the aggregate (now(), currentUser, ` +
    `literals), or store the aggregate relationally.`,
  "loom.tph-backend-unsupported": (p: { name: unknown; role: unknown; how: unknown }) =>
    `aggregate '${p.name}' (${p.role}) resolves to sharedTable (TPH) inheritance via ` +
    `${p.how}, but no backend deployable hosts this context, so there is no TPH storage ` +
    `emission target. Host the context on a backend deployable, or declare ` +
    `'inheritanceUsing: ownTable' to use the per-concrete (TPC) layout. ` +
    `Tracked in aggregate-inheritance.md I2/I3.`,
  "loom.provenanced-backend-unsupported": (p: { name: unknown; names: unknown }) =>
    `aggregate '${p.name}' has provenanced field(s) ${p.names}, but no backend deployable ` +
    `hosts this context, so the provenance runtime (trace capture + history) is not emitted. ` +
    `Host the context on a backend deployable, or drop the 'provenanced' modifier to use a ` +
    `plain field. Tracked in provenance.md / type-system-feature-migration.md (DBT-1).`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/reserved-surfaces.ts
  // ----------------------------------------------------------------------
  "loom.reserved-not-emitted": (p: { spelling: unknown; consequence: unknown }) =>
    `\`${p.spelling}\` parses and reaches the IR, but no emitter reads it — the generated ` +
    `output is byte-identical without the clause.  At runtime ${p.consequence}.  ` +
    `Drop the clause until the feature lands (the warning disappears with it), or keep it as ` +
    `intent and treat the behaviour above as what actually ships.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/ui-render-slot-checks.ts
  // ----------------------------------------------------------------------
  // The value-object sibling of `loom.money-in-text-slot` (M-T5.42, V7).
  "loom.valueobject-in-text-slot": (p: {
    primitive: unknown;
    path: unknown;
    aggregate: unknown;
    valueObject: unknown;
  }) =>
    `\`${p.primitive}\` renders \`${p.path}\` — a \`${p.valueObject}\` value object ` +
    `(\`${p.aggregate}.${String(p.path).split(".").pop()}\`) — as TEXT.  A value object crosses ` +
    `the wire as a JSON OBJECT, which is not a renderable node: the generated frontend fails to ` +
    `TYPECHECK (\`TS2322: Type '${p.valueObject}' is not assignable to type 'ReactNode'\`), and ` +
    `the other frontends have the same hole in their own wording.  Render one of its fields ` +
    `(\`${p.path}.<field>\`), or add a \`derived\` string member that formats it.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/test-checks.ts
  // ----------------------------------------------------------------------
  "loom.aggregate-test-context": (p: { name: unknown; testName: unknown; reason: unknown }) =>
    `aggregate '${p.name}' test '${p.testName}': ${p.reason} ` +
    `Aggregate-level tests are bound to a value-object / pure-function context — they don't have a 'this' aggregate to mutate.  ` +
    `Move the operation invocation inside an aggregate operation or rewrite the test to assert via 'expect' / 'expect-throws'.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/workflow-checks.ts
  // ----------------------------------------------------------------------
  "loom.create-name-conflict-workflow": (p: { name: unknown; count: unknown; name2: unknown }) =>
    `workflow '${p.name}' declares ${p.count} 'create' starters named '${p.name2}'; ` +
    `create names must be unique within a workflow.`,
  // An aggregate factory call in its retired record form (D-CREATE-CALL-STYLE).
  "loom.create-record-form": (p: { agg: unknown; owner: unknown }) =>
    `'${p.agg}.create({ … })' in ${p.owner} passes the create input as one record. An ` +
    `aggregate's 'create' is called like any other method: by name, '${p.agg}.create(x: a, ` +
    `y: b)', or by position against a declared 'create(x, y)' signature, ` +
    `'${p.agg}.create(a, b)'. ` +
    `'node scripts/codemod-create-record-to-call.mjs <path>' rewrites every record-form call ` +
    `into the named form.`,
  // A factory call whose arguments map onto no create-input record
  // (`language/factory-call.ts`).
  "loom.create-args": (p: {
    agg: unknown;
    owner: unknown;
    given: unknown;
    count: unknown;
    inputs: unknown;
  }) =>
    `'${p.agg}.create(…)' in ${p.owner} passes ${p.given} positional argument(s), but ` +
    `the declared '${p.agg}.create(…)' takes ${p.count} parameter(s), in order: ${p.inputs}. ` +
    `Positions bind to those parameters in order; drop the extra arguments, or name each one.`,
  "loom.create-args#mixed": (p: { agg: unknown; owner: unknown }) =>
    `'${p.agg}.create(…)' in ${p.owner} mixes positional and named arguments. Pass every ` +
    `argument by name, or every one by position against a declared 'create(…)' signature.`,
  "loom.create-args#positional-without-create": (p: {
    agg: unknown;
    owner: unknown;
    example: unknown;
    inputs: unknown;
  }) =>
    `'${p.agg}.create(…)' in ${p.owner} passes positional arguments, but '${p.agg}' declares ` +
    `no 'create(…)' signature for positions to bind to. Name each argument, ` +
    `'${p.agg}.create(${p.example})'; its create inputs are ${p.inputs}. Or declare ` +
    `'create(…)' with parameters to call it by position.`,
  "loom.create-args#not-in-create": (p: {
    agg: unknown;
    owner: unknown;
    name: unknown;
    inputs: unknown;
  }) =>
    `'${p.agg}.create(…)' in ${p.owner} passes '${p.name}', which the declared 'create(…)' ` +
    `does not list. Its parameters (${p.inputs}) are the factory input; every other field ` +
    `takes its declared default. Drop the argument, or add the field to the 'create' parameters.`,
  "loom.create-args#duplicate": (p: { agg: unknown; owner: unknown; name: unknown }) =>
    `'${p.agg}.create(…)' in ${p.owner} passes '${p.name}' twice. Pass each input once.`,

  // ----------------------------------------------------------------------
  // src/macros/expander.ts
  // ----------------------------------------------------------------------
  "loom.softdelete-field-collision": (p: { name: unknown; name2: unknown }) =>
    `field 'isDeleted' on aggregate '${p.name}' collides with the 'softDeletable' capability's flag, which is a 'bool' ` +
    `(the spliced 'filter !this.isDeleted' reads it). Rename this field (e.g. '${p.name2}Deleted'), or declare it ` +
    `'isDeleted: bool' if you meant the soft-delete flag.`,
  "loom.softdelete-field-collision#timestamp": (p: { name: unknown; name2: unknown }) =>
    `field 'deletedAt' on aggregate '${p.name}' collides with the 'softDeletable' capability's timestamp, which is a ` +
    `'datetime?' (the 'softDelete' macro's operation assigns it). Rename this field (e.g. '${p.name2}DeletedAt'), or ` +
    `declare it 'deletedAt: datetime?' if you meant the soft-delete timestamp.`,
} satisfies Record<string, MessageEntry>;

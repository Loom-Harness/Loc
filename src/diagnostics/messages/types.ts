// The `types` family of the diagnostic-message catalog: the type system and expressions: collections, payloads, unions, generics, money / numeric / duration literals, conversions, comparisons, interpolation, intrinsics and operators.
//
// A code lives in the family that owns its first segment (`loom.<segment>-…`),
// listed in `segments` below; `../messages.ts` merges every family into
// `DIAGNOSTIC_MESSAGES`, and `test/system/diagnostic-catalog.test.ts` fails on a
// key filed under the wrong family.  A code with a brand-new first segment adds
// that segment to the family it belongs with.

import type { MessageEntry } from "./_shared.js";

/** The code first-segments this family owns. */
export const segments = [
  "collection",
  "payload",
  "union",
  "generic",
  "option",
  "variant",
  "money",
  "integer",
  "duration",
  "convert",
  "compare",
  "nullable",
  "absent",
  "token",
  "interp",
  "intrinsic",
  "matches",
  "operator",
  "assign",
  "let",
  "return",
  "call",
  "lambda",
  "ternary",
  "contain",
  "invariant",
  "precondition",
  "rule",
  "i18n",
  "blank",
  "parameter",
  "param",
  "avg",
  "distinct",
  "reduction",
  "join",
] as const;

export const messages = {
  // ----------------------------------------------------------------------
  // src/language/validators/_shared.ts
  // ----------------------------------------------------------------------
  // The `message "…"` clause left the language: a rule is NAMED and its text
  // is keyed by identity.  The grammar still parses the clause so this error can
  // name the rule it becomes.
  "loom.rule-message-removed": (p: {
    rule: unknown;
    name: unknown;
    file: unknown;
    key: unknown;
    text: unknown;
  }) =>
    `'message "…"' on ${p.rule} is no longer part of the language: name the rule — '${p.rule} ${p.name}: …' — and put its text in ${p.file} as "${p.key}": ${JSON.stringify(String(p.text))}. Run 'node scripts/codemod-rule-names.mjs <path>' to migrate every rule at once.`,
  "loom.rule-name-duplicate": (p: { name: unknown; owner: unknown }) =>
    `Rule name '${p.name}' is already used in '${p.owner}' — invariants, field checks and preconditions share one rule namespace per owner, because the name is the rule's i18n key. Rename one of them.`,

  // ----------------------------------------------------------------------
  // src/language/validators/callable-sites.ts
  // ----------------------------------------------------------------------
  // A default on a site whose lowerer drops it (`defaults: false`) — refused
  // rather than silently discarded (M-T5.42, V2).
  "loom.param-default-unsupported": (p: { name: unknown; label: unknown }) =>
    `Parameter '${p.name}' declares a default, but ${p.label} does not support parameter defaults: the default would be dropped and every generated signature would still require the argument. Remove '= …' and pass the value at each call site (an aggregate operation, create or destroy, or a workflow create, does honour a default).`,

  // ----------------------------------------------------------------------
  // src/language/validators/channel.ts
  // ----------------------------------------------------------------------
  "loom.collection-field-unpersisted#optional-reference": (p: {
    owner: unknown;
    ownerName: unknown;
    field: unknown;
  }) =>
    `${p.owner} '${p.ownerName}' field '${p.field}' is an OPTIONAL reference collection ('X id[]?'). ` +
    `A reference collection is a set and the empty set already means "none", so the schema has ` +
    `no optional form of it.  Drop the '?' (declare '${p.field}: X id[]').`,
  "loom.collection-field-unpersisted#part-reference": (p: { ownerName: unknown; field: unknown }) =>
    `entity part '${p.ownerName}' field '${p.field}' is a reference collection ('X id[]'), but a ` +
    `join table is derived only for an aggregate root's own 'X id[]' fields, so no backend would ` +
    `store these ids.  Move '${p.field}' onto the aggregate root, or make the part hold a single ` +
    `'X id' and contain one part per referenced id.`,
  "loom.collection-field-unpersisted#part-value-collection": (p: {
    ownerName: unknown;
    field: unknown;
    hosts: unknown;
  }) =>
    `entity part '${p.ownerName}' field '${p.field}' is a value-object collection ('<VO>[]'), but ` +
    `this context's persistence adapters are ${p.hosts}: Dapper and MikroORM keep a part's ` +
    `value-object collection in a jsonb column of their own, while every other adapter keeps it in ` +
    `the part's child table, so the hosts would not read each other's writes.  Host the context ` +
    `on one kind of adapter, move '${p.field}' onto the aggregate root, or model each element as a ` +
    `contained entity part.`,
  "loom.collection-field-unpersisted#state-value-collection": (p: {
    owner: unknown;
    ownerName: unknown;
    field: unknown;
  }) =>
    `${p.owner} '${p.ownerName}' state field '${p.field}' is a value-object collection ('<VO>[]'), ` +
    `but a ${p.owner} state row is one table row with no child tables, so no backend would store ` +
    `it.  Keep the collection on an aggregate (where it gets its own child table), or store ` +
    `scalar collections ('string[]', 'X id[]') on the state row instead.`,
  "loom.collection-field-unpersisted#nested-in-value-object": (p: {
    owner: unknown;
    ownerName: unknown;
    field: unknown;
    voName: unknown;
    path: unknown;
  }) =>
    `${p.owner} '${p.ownerName}' field '${p.field}' persists value object '${p.voName}', which holds ` +
    `a collection of references or value objects ('${p.path}').  A persisted value object ` +
    `flattens into scalar '<field>_<sub>' columns, and such a collection has no column shape, so ` +
    `no backend would store it.  Declare the collection directly on the aggregate (or entity ` +
    `part) instead of inside '${p.voName}'.`,

  // ----------------------------------------------------------------------
  // src/language/validators/composition.ts
  // ----------------------------------------------------------------------
  "loom.i18n-source-invalid": (p: { source: unknown }) =>
    `'${p.source}' is not a valid BCP-47 language tag for 'i18n { source: … }'. ` +
    'Use a tag such as "en", "de" or "pt-BR".',
  "loom.i18n-duplicate": (p: { name: unknown }) =>
    `system '${p.name}' declares more than one 'i18n { ... }' block; keep just the first.`,

  // ----------------------------------------------------------------------
  // src/language/validators/generics.ts
  // ----------------------------------------------------------------------
  "loom.generic-position": (p: { ctors: unknown }) =>
    `A generic carrier ('${p.ctors}') is a transport shape — it may only appear as a ` +
    `query-handler return type or a payload field, not in this position.`,
  "loom.generic-arg-not-carrier#nested-generic-carriers": (p: {
    ctors: unknown;
    ctors2: unknown;
  }) =>
    `Nested generic carriers are not supported yet — '${p.ctors}' applies ` +
    `'${p.ctors2}' to another generic instance. v1 allows a single ` +
    `carrier constructor (P3b adds nesting).`,
  "loom.generic-arg-not-carrier#requires-a-carrier-type": (p: { ctors: unknown }) =>
    `'${p.ctors}' requires a carrier type argument; 'slot' is a UI-only marker, ` +
    `not a boundary-crossing carrier.`,

  // ----------------------------------------------------------------------
  // src/language/validators/payload.ts
  // ----------------------------------------------------------------------
  "loom.payload-name-conflict#duplicate-payload-in-context": (p: {
    name: unknown;
    ctxName: unknown;
  }) => `Duplicate payload '${p.name}' in context '${p.ctxName}'.`,
  "loom.payload-name-conflict#payload-collides-with-a": (p: {
    name: unknown;
    peerNames: unknown;
    ctxName: unknown;
  }) =>
    `Payload '${p.name}' collides with a ${p.peerNames} of the same name in ` +
    `context '${p.ctxName}'.`,
  "loom.payload-duplicate-field": (p: { name: unknown; mName: unknown }) =>
    `Duplicate field '${p.name}' in payload '${p.mName}'.`,

  // ----------------------------------------------------------------------
  // src/language/validators/seed.ts
  // ----------------------------------------------------------------------
  // `toContain` dispatches on the SUBJECT's type \u2014 membership for a collection,
  // substring for a string.  Any other subject has no third lowering, and the
  // IR is where the resolved type is available to say so.
  "loom.contain-receiver-invalid": (p: { actual: unknown; type: unknown }) =>
    `'toContain' asserts membership in a COLLECTION or a SUBSTRING of a string, chosen by ` +
    `the type of the subject \u2014 but '${p.actual}' is \`${p.type}\`, which is neither. ` +
    "For a scalar, assert it directly with `toBe(...)`; for an optional, `toBeNull()`.",
  // `toBeAbsent()` on something that is not a field read.  The matcher rewrites
  // its assertion onto the receiver (`"estimate" in read`), so it needs an
  // object and a key; without them the e2e renderer hits its compiler-invariant
  // throw and `generate system` dies with a stack trace instead of a message.
  "loom.absent-receiver-invalid": (p: { actual: unknown }) =>
    `'toBeAbsent()' asks whether a KEY is missing from a payload, so it has to be applied ` +
    `to a field read \u2014 \`expect(<read>.<field>).toBeAbsent()\`. Here the subject is ` +
    `'${p.actual}', which names no key to look for. If you meant "this value is null", ` +
    "that is `toBeNull()`.",

  // ----------------------------------------------------------------------
  // src/language/validators/statements.ts
  // ----------------------------------------------------------------------
  "loom.call-arg-type": (p: { i: unknown; label: unknown; expected: unknown; actual: unknown }) =>
    `Argument ${p.i} of ${p.label} expects '${p.expected}' but got '${p.actual}'.`,
  "loom.call-arg-count": (p: {
    label: unknown;
    length: unknown;
    length2: unknown;
    argsLength: unknown;
  }) => `${p.label} expects ${p.length} argument${p.length2}, got ${p.argsLength}.`,

  // --- the M-T9.56 drain of `statements.ts` -------------------------------
  "loom.precondition-not-bool": (p: { actual: unknown }) =>
    `'precondition' must be of type 'bool', got '${p.actual}'.`,
  "loom.assign-to-derived": (p: { path: unknown }) =>
    `Cannot assign to derived property '${p.path}'.`,
  "loom.assign-type-mismatch": (p: { actual: unknown; expected: unknown }) =>
    `Cannot assign '${p.actual}' to '${p.expected}'.`,
  "loom.collection-mutation-non-collection": (p: { op: unknown; actual: unknown }) =>
    `'${p.op}' requires a collection on the left-hand side, got '${p.actual}'.`,
  "loom.collection-mutation-element-type": (p: {
    verb: unknown;
    actual: unknown;
    element: unknown;
  }) => `Cannot ${p.verb} element of type '${p.actual}' to/from collection of '${p.element}'.`,

  // ----------------------------------------------------------------------
  // src/language/validators/stmt-placement.ts
  // ----------------------------------------------------------------------
  // Placement rulings D-FOR-IN-DOMAIN (amended by D-FAILURE-MODEL).  The
  // design-rule messages state where the construct lives rather than advising
  // a construct that may later move.
  "loom.variant-match-placement": (p: { owner: unknown }) =>
    `A 'match' used for its EFFECTS (arms that run statements) is not available in ${p.owner}: a fold ('apply', a projection 'on') is a straight-line state transition and a 'function' computes a value, so neither has a statement form of it. Use the value form instead — 'let x = match r { A a => …, else => … }' — or move the effect into the operation, workflow or handler that calls it, where a statement 'match' is legal.`,

  // ----------------------------------------------------------------------
  // src/language/validators/structural.ts
  // ----------------------------------------------------------------------
  // --- the M-T9.56 drain of `structural.ts` -------------------------------
  "loom.token-nullable": (p: { name: unknown; aggName: unknown }) =>
    `Token field '${p.name}' on aggregate '${p.aggName}' cannot be nullable; \`token\` requires a non-optional type.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/structural-checks.ts
  // ----------------------------------------------------------------------
  "loom.collection-op-in-ui#distinct":
    "collection op '.distinct' isn't available in a page body — the frontends render " +
    "the ops that RESHAPE a collection (count, where, any, all, map, sortBy, take, " +
    "skip, join), but not this one: it needs VALUE equality, and Flutter's generated " +
    "wire models define no 'operator ==', so a page would silently keep the " +
    "duplicates. Do the transformation server-side instead — a view, a 'derived', or " +
    "a 'projection' read model.",
  "loom.collection-op-in-ui#any-op": (p: { member: unknown }) =>
    `collection op '.${p.member}' isn't available in a page body — the frontends ` +
    `render the ops that RESHAPE a collection (count, where, any, all, map, sortBy, ` +
    `take, skip, join), but not this one: it folds arithmetic over the projected ` +
    `values, and 'money' is a Decimal object on React/Vue/Svelte/Angular and Phoenix ` +
    `but a native scalar on Feliz and Flutter. Do the transformation server-side ` +
    `instead — a view, a 'derived', or a 'projection' read model.`,

  // --- M-T5.34 / #2864 D6, decision D-2 -----------------------------------
  "loom.distinct-non-scalar":
    "`.distinct` requires a scalar or value-object element — it can't dedupe a collection of entities or id references.",
  "loom.join-non-string": "`.join` requires a string collection.",
  "loom.reduction-non-comparable":
    "`.min`/`.max` require a comparable projection (number, money, string, or datetime).",

  // --- the M-T9.56 drain of `match.ts` ------------------------------------
  // The four `matches(<regex>)` rules stay four codes: arity, named-argument,
  // non-literal and un-compilable are four different fixes.
  "loom.matches-arity": "'matches' takes exactly one argument (a string-literal regex pattern).",
  "loom.matches-named-arg":
    "'matches' takes a single positional argument; named arguments are not supported.",
  "loom.matches-not-literal":
    "'matches' argument must be a string literal — patterns must be known at codegen time.",
  "loom.matches-invalid-regex": (p: { reason: unknown }) =>
    `'matches' pattern is not a valid regular expression: ${p.reason}`,
  "loom.union-read-undiscriminated": (p: {
    receiver: unknown;
    member: unknown;
    variants: unknown;
    first: unknown;
  }) =>
    `'${p.receiver}.${p.member}' reads through an 'or'-union value (${p.variants}) — it holds ONE of those variants, so the read is an unguarded dereference (a compile error on node/.NET, a 500 on java/python/elixir). Discriminate it first: 'match ${p.receiver} { ${p.first} x => x.${p.member}, else => … }'.`,
  "loom.union-read-undiscriminated#op-call": (p: {
    receiver: unknown;
    op: unknown;
    variants: unknown;
    first: unknown;
  }) =>
    `'${p.receiver}.${p.op}()' invokes an operation on an 'or'-union value (${p.variants}) — it holds ONE of those variants, so there is no aggregate to run it on until the value is discriminated. Load it with a find declared ': ${p.first}' (absent → 404) or 'get', or branch on the variant with 'match'.`,

  // ----------------------------------------------------------------------
  // src/language/validators/template.ts
  // ----------------------------------------------------------------------
  "loom.interp-format-unknown": (p: { format: unknown }) =>
    `Unsupported template format '${p.format}'. Supported ICU formats are ` +
    `\`number\` (incl. \`::currency/USD\`, \`::percent\`), \`date\`/\`time\`, ` +
    `\`plural\`/\`selectordinal\`, and \`select\`.`,
  "loom.interp-format-dropped-in-domain": (p: { format: unknown; host: unknown }) =>
    `This '${p.format}' hole sits in a '${p.host}' body, which runs as backend domain code: ` +
    `every backend renders the hole as its bare value and DROPS the branch text ` +
    `(\`{n, plural, one {# item} other {# items}}\` yields "3", not "3 items"). ` +
    `Only a ui page slot renders ICU '${p.format}' (through the i18n runtime). ` +
    `Spell the branches with \`match\` or a ternary here, or move the template into the page.`,
  "loom.interp-hole-type#select-format": (p: { t: unknown }) =>
    `A 'select' format expects a string or enum value, but this hole is '${p.t}'.`,
  "loom.interp-hole-type#date-format": (p: { kind: unknown; t: unknown }) =>
    `A '${p.kind}' format expects a 'datetime' value, but this hole is '${p.t}'.`,
  "loom.interp-hole-type#number-format": (p: { kind: unknown; t: unknown }) =>
    `A '${p.kind}' format expects a numeric value (int, decimal, or money), but this hole ` +
    `is '${p.t}'.`,
  "loom.interp-hole-type#not-stringifiable": (p: { t: unknown }) =>
    `Cannot interpolate a '${p.t}' — a template hole must be a string or a ` +
    `stringifiable value (number, bool, enum, an 'X id', or an aggregate with a ` +
    `'derived display'). Convert it first (e.g. wrap in a 'derived' that formats it).`,

  // ----------------------------------------------------------------------
  // src/language/validators/temporal.ts
  // ----------------------------------------------------------------------
  "loom.duration-arity": (p: { unit: unknown }) =>
    `'${p.unit}' takes exactly 1 argument — write '${p.unit}(<int>)'.`,
  "loom.duration-arg-type": (p: { unit: unknown; actual: unknown }) =>
    `'${p.unit}' takes an 'int' amount, got '${p.actual}'. ` +
    `Fractional spans are written in the finer unit ('hours(36)', not 'days(1.5)').`,

  // ----------------------------------------------------------------------
  // src/language/validators/toplevel-function.ts
  // ----------------------------------------------------------------------
  // ONE code for the return-type mismatch at all three sites that used to word
  // it separately: the top-level expression-form function here, and the member
  // function's expression body and block-body `return` in `types.ts`.  Same
  // rule, one sentence, three call sites (M-T9.56).
  "loom.let-type-mismatch": (p: { name: unknown; actual: unknown; declared: unknown }) =>
    `'let ${p.name}' is declared '${p.declared}' but its value is '${p.actual}'.`,
  "loom.return-type-mismatch": (p: { label: unknown; actual: unknown; declared: unknown }) =>
    `${p.label} returns '${p.actual}' but is declared to return '${p.declared}'.`,
  "loom.return-missing": (p: { label: unknown; declared: unknown }) =>
    `${p.label} is declared to return '${p.declared}' but not every path ends in a \`return\`. ` +
    `End each branch with \`return <value>\` (an \`if\` needs an \`else\` that returns too).`,

  // ----------------------------------------------------------------------
  // src/language/validators/types.ts
  // ----------------------------------------------------------------------
  // --- the M-T9.56 drain of `types.ts` ------------------------------------
  "loom.operator-non-bool-operands": (p: { op: unknown; left: unknown; right: unknown }) =>
    `Operator '${p.op}' requires boolean operands; got '${p.left}' and '${p.right}'.`,
  "loom.operator-operand-mismatch": (p: {
    op: unknown;
    left: unknown;
    right: unknown;
    hint: unknown;
  }) =>
    `Operator '${p.op}' has incompatible operand types: left is '${p.left}', right is '${p.right}'.${p.hint}`,
  "loom.convert-aggregate-no-display": (p: { name: unknown; lower: unknown }) =>
    `Aggregate '${p.name}' has no display form — ` +
    `declare \`derived display: string = ...\` on '${p.name}' ` +
    `to enable \`string(${p.lower})\` and implicit string concatenation.`,
  "loom.convert-non-primitive": (p: { source: unknown; target: unknown }) =>
    `Cannot convert '${p.source}' to '${p.target}': ` +
    `value objects, entities, and collections have no canonical string ` +
    `form. Reference a specific field (e.g. \`string(value.<field>)\`) ` +
    `or wait for a future toString derivation.`,
  "loom.convert-pair-invalid": (p: { source: unknown; target: unknown }) =>
    `Cannot convert '${p.source}' to '${p.target}': not supported. ` +
    `Today's conversion vocabulary admits: ` +
    `string ← int | long | decimal | money | bool | guid | datetime | enum | X id; ` +
    `long ← int; decimal ← int | long | money; money ← int | long | decimal. ` +
    `'json' and 'File' have no canonical scalar form, so they are not stringifiable. ` +
    `Fallible parses (string → numeric / datetime / bool) and narrowing ` +
    `(long → int, decimal → long) are deferred pending a failure-model decision.`,
  "loom.parameter-default-type-mismatch": (p: {
    name: unknown;
    actual: unknown;
    declared: unknown;
  }) =>
    `Default for parameter '${p.name}' has type '${p.actual}' but the parameter is declared '${p.declared}'.`,
  "loom.invariant-not-bool": (p: { actual: unknown }) =>
    `Invariant must be of type 'bool', got '${p.actual}'.`,
  "loom.invariant-guard-not-bool": (p: { actual: unknown }) =>
    `Invariant guard ('when ...') must be of type 'bool', got '${p.actual}'.`,
  "loom.rule-expr-impure#unaddressable": (p: { where: unknown; name: unknown; kind: unknown }) =>
    `This ${p.where} references '${p.name}', which is a ${p.kind} — not something a rule expression can reach. ` +
    `An invariant / check / derived is a PURE predicate over the instance: it runs in the per-instance floor with only 'this' in scope, ` +
    `so it may not call a repository, an operation, or a workflow (the same rule a pure 'function' follows). ` +
    `Emitting it anyway produces an unresolvable identifier in the generated backend. ` +
    `Denormalize the value onto this aggregate (copy the field at write time) and assert over that, or move the rule into the operation / workflow that already loads '${p.name}'.`,
  "loom.rule-expr-impure#operation": (p: { where: unknown; name: unknown }) =>
    `This ${p.where} calls '${p.name}', which is an action (operation / create / destroy) on this aggregate. ` +
    `A rule expression is a PURE predicate over the instance — it runs inside the invariant floor that the action itself triggers, ` +
    `so calling back into the mutating layer is both unrenderable and unbounded. ` +
    `Extract the logic into a pure 'function' and call that from both places.`,
  "loom.collection-op-in-ui#avg":
    "collection op '.avg' isn't available in a page body — the frontends render the " +
    "ops that RESHAPE a collection (count, where, any, all, map, sortBy, take, skip, " +
    "join), but not this one: it desugars to a sum over the projected values, and " +
    "'money' is a Decimal object on React/Vue/Svelte/Angular and Phoenix but a native " +
    "scalar on Feliz and Flutter. Do the transformation server-side instead — a view, " +
    "a 'derived', or a 'projection' read model.",
  "loom.avg-non-numeric": "`.avg` requires a numeric projection (int, long, decimal, or money).",
  "loom.intrinsic-bare": (p: { member: unknown; signature: unknown }) =>
    `'${p.member}' is an intrinsic operation and needs a call — write '.${p.member}${p.signature})'.`,
  "loom.intrinsic-arity": (p: { member: unknown; expected: unknown; signature: unknown }) =>
    `'${p.member}' takes ${p.expected} argument(s) — signature: ${p.member}${p.signature}.`,
  "loom.intrinsic-named-arg": (p: { member: unknown }) =>
    `'${p.member}' takes positional arguments only.`,
  "loom.intrinsic-arg-type": (p: {
    member: unknown;
    i: unknown;
    actual: unknown;
    signature: unknown;
    expected: unknown;
  }) =>
    `'${p.member}' argument ${p.i} is '${p.actual}' but the signature ${p.member}${p.signature} expects '${p.expected}'.`,
  "loom.intrinsic-unknown": (p: { name: unknown; member: unknown; known: unknown }) =>
    `'${p.name}' has no intrinsic '.${p.member}()'${p.known}.`,
  "loom.nullable-receiver": (p: { member: unknown; recv: unknown }) =>
    `'${p.member}' can't be read on '${p.recv}' — the receiver may be null and every backend emits a bare dereference. ` +
    `Guard it with a null test the read depends on: '<expr> != null ? <expr>${p.member} : …', ` +
    `'<expr> != null && <expr>${p.member} …' or '<expr> == null || <expr>${p.member} …'.`,
  "loom.nullable-receiver#statement": (p: { where: unknown; name: unknown; use: unknown }) =>
    `'${p.where}': '${p.name}' may be null (it is bound to a read that can find no row), so ` +
    `'${p.use}' dereferences it unguarded on every backend.  Narrow it first: ` +
    `'if let x = ${p.name} { … } else { … }'.`,
  "loom.ternary-condition": (p: { condT: unknown }) =>
    `Ternary condition must be of type 'bool', got '${p.condT}'.`,
  "loom.ternary-branches": (p: { thenT: unknown; elseT: unknown }) =>
    `Ternary branches have incompatible types: then-branch is '${p.thenT}', ` +
    `else-branch is '${p.elseT}'.  One branch's type must be assignable to ` +
    `the other (both numeric, an optional and its inner, or a null literal against an optional).`,

  // ----------------------------------------------------------------------
  // src/language/validators/unions.ts
  // ----------------------------------------------------------------------
  "loom.union-position":
    `An inline 'or' union is a transport shape — it may appear only as an operation's or a ` +
    `domainService operation's return type, or, with at least one 'error' variant, as the ` +
    `result of a workflow 'create', a 'commandHandler' or a 'queryHandler' ` +
    `('create(…): Receipt or PaymentDeclined'), where the error answers its mapped status. ` +
    `Not in this position.`,
  "loom.union-position#payload-field":
    `An inline 'or' union cannot be a payload field: the tagged union wire is emitted only ` +
    `at the top of an operation or find return, and no backend renders one nested inside a ` +
    `record (an error payload, a command or workflow input).  Return the union from the ` +
    `operation itself ('operation x(): A or B'), or give the payload one field per variant ` +
    `('circle: Circle?', 'square: Square?').`,
  "loom.union-variant-not-carrier": `'slot' is a UI-only marker, not a union variant — every variant must be a carrier type.`,
  "loom.union-duplicate-variant":
    `Duplicate union variant — each variant must be a distinct type so the wire ` +
    `discriminator stays unambiguous.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/api-checks.ts
  // ----------------------------------------------------------------------
  "loom.option-deprecated":
    "`T option` is deprecated: it means `T?`, the one way to say a value may be missing. " +
    "Write `T?` instead — the quick fix rewrites it.",

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/projection-checks.ts
  // ----------------------------------------------------------------------
  "loom.integer-literal-imprecise": (p: { written: unknown; held: unknown; ceiling: unknown }) =>
    `integer literal ${p.written} is outside the range Loom carries exactly ` +
    `(±${p.ceiling}, 2^53−1) — the toolchain reads it as ${p.held}, and every ` +
    `backend would emit THAT value. That ceiling is 'long''s declared contract ` +
    `(it persists as a bigint but is carried as a JS number on the node backend), ` +
    `and the same bound is enforced at the wire boundary. Use a 'string' field if ` +
    `the digits must survive verbatim.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/ui-body-vocabulary-checks.ts — the frontend body
  // vocabulary.  The first three are modelling errors no frontend can render;
  // the fourth is the per-target table (`UI_BODY_FEATURE_RENDERERS`).
  // ----------------------------------------------------------------------
  "loom.lambda-param-type-unknown": (p: { param: unknown; where: unknown; uiName: unknown }) =>
    `Lambda parameter '${p.param}' in ${p.where} on ui '${p.uiName}' has no known type, so a ` +
    `member read off it cannot be typed. A lambda parameter is typed by the collection it ` +
    `iterates (\`For { each: xs, … }\`, \`Table { rows: xs, … }\`, a collection op) or by the ` +
    `read it plots or displays (\`Chart { of: … }\`, \`QueryView { of: …, data: … }\`); bind ` +
    `the lambda inside one of those, or read the value through a typed name instead.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/ui-render-slot-checks.ts
  // ----------------------------------------------------------------------
  // The `money` value cannot be rendered as text; the two arms differ only in
  // WHERE `Money { … }` goes.  A one-slot text primitive coerces its slot to a
  // string, so a nested primitive there renders EMPTY — the fix is to replace
  // the call.  `Stat` / `KeyValueRow` walk a nested primitive in their value
  // slot on purpose, so the fix is to wrap in place.
  "loom.money-in-text-slot#replace": (p: {
    primitive: unknown;
    path: unknown;
    aggregate: unknown;
  }) =>
    `\`${p.primitive} { ${p.path} }\` renders a \`money\` value ` +
    `(\`${p.aggregate}.${String(p.path).split(".").pop()}\`) as TEXT.  \`money\` crosses the wire ` +
    `as a decimal string and deserialises client-side to a \`Decimal\` OBJECT, which is not a ` +
    `renderable node — the generated frontend fails to TYPECHECK (\`TS2322: Type 'Decimal' is ` +
    `not assignable to type 'ReactNode'\`), and the other frontends have the same hole in their ` +
    `own wording.  Write \`Money { ${p.path} }\` instead: it is the formatter primitive, and it ` +
    `is what the scaffolded table renders every money column through, so the amount also comes ` +
    `out WITH its currency.  \`${p.primitive} { Money { … } }\` does NOT work — a one-slot text ` +
    `primitive coerces its slot to a string and a nested primitive there renders empty.`,
  "loom.money-in-text-slot#wrap": (p: { primitive: unknown; path: unknown; aggregate: unknown }) =>
    `\`${p.primitive}\`'s value slot renders a \`money\` value ` +
    `(\`${p.aggregate}.${String(p.path).split(".").pop()}\`) as TEXT.  \`money\` crosses the wire ` +
    `as a decimal string and deserialises client-side to a \`Decimal\` OBJECT, which is not a ` +
    `renderable node — the generated frontend fails to TYPECHECK (\`TS2322: Type 'Decimal' is ` +
    `not assignable to type 'ReactNode'\`), and the other frontends have the same hole in their ` +
    `own wording.  \`${p.primitive}\` walks a nested primitive in that slot, so wrap it in ` +
    `place: \`Money { ${p.path} }\`.  That is also what renders the amount WITH its currency.`,

  // src/language/validators/types.ts — the `money("…")` literal's argument.
  //
  // The string is handed verbatim to five backends' precise-decimal
  // constructors (`new Decimal(…)`, `System.Decimal.Parse`, `Decimal.new/1`,
  // `BigDecimal`, Python `Decimal`), so a non-numeric one is not a Loom error
  // — it is a THROW inside generated code, at whatever moment the literal is
  // first evaluated.  Checkable at the source, so it is checked at the source.
  // ----------------------------------------------------------------------
  "loom.money-literal-malformed": (p: { text: unknown }) =>
    `money("${p.text}") is not a decimal amount. The string argument of a money ` +
    `literal is parsed by each backend's precise-decimal type verbatim, so this ` +
    `throws in the generated code rather than here. Write an optionally signed ` +
    `decimal — money("10.50"), money("-3.25"), money("0") — with no currency ` +
    `symbol, thousands separator or exponent. To convert a value at runtime ` +
    `instead, pass the expression: money(someDecimal).`,

  // src/language/validators/types.ts — comparison operands
  // ----------------------------------------------------------------------
  "loom.compare-type-mismatch": (p: { op: unknown; lt: unknown; rt: unknown }) =>
    `Operator '${p.op}' cannot compare '${p.lt}' with '${p.rt}'. ` +
    `Operands must be the same type, both numeric (int / long / decimal), both money, ` +
    `or one a null literal against an optional.`,
  // The same failure, when the reason is that a same-named declaration won a
  // bare enum case.  Without this the author reads "cannot compare 'Status'
  // with 'bool'" about a line that says `status == Open` and has no way to
  // see that `Open` stopped meaning the case.
  "loom.compare-type-mismatch#enum-case-shadowed": (p: {
    op: unknown;
    lt: unknown;
    rt: unknown;
    name: unknown;
    enumName: unknown;
    kind: unknown;
  }) =>
    `Operator '${p.op}' cannot compare '${p.lt}' with '${p.rt}'. ` +
    `'${p.name}' here resolves to the ${p.kind} '${p.name}', not the '${p.enumName}' case ` +
    `of the same name — the ${p.kind} shadows the enum case. Write '${p.enumName}.${p.name}' ` +
    `for the case, or rename the ${p.kind}.`,
  "loom.collection-field-unpersisted#nested-in-value-object-document": (p: {
    owner: unknown;
    ownerName: unknown;
    field: unknown;
    voName: unknown;
    path: unknown;
  }) =>
    `${p.owner} '${p.ownerName}' field '${p.field}' persists value object '${p.voName}', which holds ` +
    `a collection of references ('${p.path}').  A 'shape: document' aggregate stores the value ` +
    `object inside its jsonb document, but a reference collection persists only as a join table, ` +
    `and no join table is derived for a collection nested inside a value object, so no backend ` +
    `would store it.  Declare the 'X id[]' directly on the aggregate instead of inside ` +
    `'${p.voName}'.`,
} satisfies Record<string, MessageEntry>;

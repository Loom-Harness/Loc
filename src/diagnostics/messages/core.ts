// The `core` family of the diagnostic-message catalog: name resolution (unknown / unresolved / duplicate / ambiguous names), parse errors, macro expansion, and internal compiler errors.
//
// A code lives in the family that owns its first segment (`loom.<segment>-…`),
// listed in `segments` below; `../messages.ts` merges every family into
// `DIAGNOSTIC_MESSAGES`, and `test/system/diagnostic-catalog.test.ts` fails on a
// key filed under the wrong family.  A code with a brand-new first segment adds
// that segment to the family it belongs with.

import { didYouMean, type MessageEntry } from "./_shared.js";

/** The code first-segments this family owns. */
export const segments = [
  "unknown",
  "unresolved",
  "duplicate",
  "ambiguous",
  "parse",
  "macro",
  "scaffold",
  "ir",
  "validator",
  "multiple",
  "no",
  "top",
] as const;

export const messages = {
  // ----------------------------------------------------------------------
  // src/language/validators/builder-call.ts
  // ----------------------------------------------------------------------
  "loom.unknown-construction-field": (p: {
    type: unknown;
    name: unknown;
    size: unknown;
    fields: unknown;
    suggestion?: unknown;
  }) =>
    `'${p.type}' has no field '${p.name}'.` +
    didYouMean(p.suggestion) +
    (p.size ? ` Declared fields: ${p.fields}.` : ""),
  "loom.unknown-builder-type": (p: { name: unknown }) =>
    `Unknown builder type '${p.name}'. Expected a ValueObject, EntityPart, user-defined component, or stdlib walker primitive (e.g., Stack, CreateForm, Card).`,

  // ----------------------------------------------------------------------
  // src/language/validators/composition.ts
  // ----------------------------------------------------------------------
  "loom.top-level-domain-needs-single-system": (p: { kw: unknown; reason: unknown }) =>
    `A top-level '${p.kw}' composes into the project's single 'system', but ${p.reason}. ` +
    "Declare exactly one 'system { ... }' across the import graph (it may hold just the name, theme, user and deployment), or nest this declaration inside it.",
  "loom.multiple-systems": (p: { count: unknown }) =>
    `The project declares ${p.count} 'system { ... }' blocks across the import graph, but a project has exactly one. ` +
    "The system is what composition folds into and what 'generate system' emits as one deployment, so a second one has no resolution — both are merged into a single tree and a single docker-compose.yml. " +
    "Keep one 'system { ... }' and move the other's members into it, or split them into separate projects.",
  "loom.duplicate-user-block": (p: { userCount: unknown }) =>
    `The project declares ${p.userCount} 'user { ... }' blocks, but a system admits at most one. ` +
    "Keep a single user block (it may live in any file that composes into the system).",
  "loom.duplicate-theme-block": (p: { themeCount: unknown }) =>
    `The project declares ${p.themeCount} 'theme { ... }' blocks, but a system admits at most one. ` +
    "Keep a single theme block (it may live in any file that composes into the system).",
  // The SAME rule, checked a second time one scope down (M-T9.56 drain of
  // `ddd-validator.ts`): `composition.ts` counts theme blocks across every file
  // that composes into the project, this arm counts them inside one `system`
  // block.  One code, two `#slug`s — a reader who looks the code up gets one
  // rule, not two.
  "loom.duplicate-theme-block#system-scope": (p: { name: unknown }) =>
    `system '${p.name}' declares more than one 'theme { ... }' block; keep just the first.`,

  // ----------------------------------------------------------------------
  // src/language/validators/duplicates.ts
  // ----------------------------------------------------------------------
  // The two APPLICATION handler kinds share one route-target namespace.
  "loom.duplicate-repository": (p: {
    name: unknown;
    agg: unknown;
    first: unknown;
    ctxName: unknown;
  }) =>
    `Repository '${p.name}' is a second repository for aggregate '${p.agg}' in context ` +
    `'${p.ctxName}'; '${p.first}' already serves it. An aggregate has one repository — every ` +
    `repository exposes the same verb contract, so a second one is only another name for the ` +
    `same store. Use '${p.first}' and remove '${p.name}'.`,
  "loom.duplicate-handler": (p: { name: unknown; ctxName: unknown; kind: unknown }) =>
    `Duplicate handler '${p.name}' in context '${p.ctxName}'; a ${p.kind} shares its name ` +
    `with another handler. A 'route -> ${p.ctxName}.${p.name}' would ` +
    `be ambiguous — commandHandler and queryHandler names must be unique within a context.`,

  // ----------------------------------------------------------------------
  // src/language/validators/names.ts
  // ----------------------------------------------------------------------
  "loom.unknown-name": (p: { hint: unknown; name: unknown }) =>
    p.hint
      ? `Unknown name '${p.name}' — did you mean '${p.hint}'?`
      : `Unknown name '${p.name}' — no parameter, local, field, enum value, or declaration with this name is in scope.`,

  // --- the M-T9.56 drain of `statements.ts` -------------------------------
  "loom.unresolved-call": (p: { name: unknown; agg: unknown }) =>
    `Cannot resolve call to '${p.name}' from aggregate '${p.agg}'.`,
  // Two slugs, one code: a member that does not resolve while walking an
  // l-value / member-call chain.  The `#on-type` variant can name the receiver
  // type (the chain's last step knows it); the bare one cannot.
  "loom.unresolved-member": (p: { member: unknown }) => `Cannot resolve member '${p.member}'.`,
  "loom.unresolved-member#on-type": (p: { member: unknown; recv: unknown }) =>
    `Cannot resolve member '${p.member}' on type '${p.recv}'.`,
  "loom.unresolved-lvalue-head": (p: { head: unknown }) => `Cannot resolve '${p.head}'.`,

  // ----------------------------------------------------------------------
  // src/language/validators/structural.ts
  // ----------------------------------------------------------------------
  // --- the M-T9.56 drain of `structural.ts` -------------------------------
  "loom.duplicate-entity-part": (p: { name: unknown; agg: unknown }) =>
    `Duplicate entity part '${p.name}' in aggregate '${p.agg}'.`,
  "loom.duplicate-derived": (p: { name: unknown; agg: unknown }) =>
    `Aggregate '${p.agg}' declares multiple 'derived ${p.name}' fields; at most one is allowed.`,
  "loom.ambiguous-part-ref": (p: { name: unknown; list: unknown; names: unknown }) =>
    `Ambiguous entity-part reference '${p.name} id' — '${p.name}' is declared in ${p.list}. ` +
    `Entity parts are aggregate-local; reference the owning aggregate's root instead (e.g. '${p.names} id'), ` +
    `or rename one of the parts so the link is unambiguous.`,
  "loom.duplicate-applier#ast": (p: { name: unknown; ap: unknown }) =>
    `Aggregate '${p.name}' declares more than one applier for event '${p.ap}'. ` +
    `An event folds into state exactly one way — declare a single apply(${p.ap}).`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/structural-checks.ts
  // ----------------------------------------------------------------------
  "loom.duplicate-applier#ir": (p: { name: unknown; count: unknown; eventName: unknown }) =>
    `aggregate '${p.name}' declares ${p.count} appliers for event '${p.eventName}'. ` +
    `An event folds into state exactly one way — declare a single apply(${p.eventName}).`,
  "loom.duplicate-valueobject": (p: { name: unknown }) =>
    `duplicate root-level value object '${p.name}' — declare it once in the workspace.`,
  "loom.duplicate-enum": (p: { name: unknown }) =>
    `duplicate root-level enum '${p.name}' — declare it once in the workspace.`,
  "loom.duplicate-system": (p: { name: unknown }) =>
    `duplicate system '${p.name}' — declare each system once across the workspace.`,
  "loom.duplicate-context": (p: { name: unknown }) =>
    `duplicate context '${p.name}' — context names must be unique across the workspace.`,
  "loom.duplicate-table": (p: { who: unknown; key: unknown }) =>
    `aggregates ${p.who} all map to the same database table \`${p.key}\` — ` +
    `their migrations would create and clobber one relation. Give the ` +
    `owning contexts distinct \`dataSource\` schemas (\`schema: "..."\`) so ` +
    `each lands in its own Postgres schema, or rename one aggregate.`,

  // --- M-T5.34 / #2864 D6, decision D-2 -----------------------------------
  "loom.ambiguous-enum-value": (p: { value: unknown; enums: unknown; qualified: unknown }) =>
    `bare enum value '${p.value}' is declared by more than one enum in scope ('${p.enums}'), ` +
    `and this use has no expected type to choose between them. ` +
    `Write it qualified — ${p.qualified} — or rename one of the values. ` +
    `Loom resolves a bare value from the SITE's type (a field or parameter default, a ':=' target, ` +
    `either side of a comparison); nothing here supplies one, and guessing would compile to a ` +
    `comparison between two different enums.`,
  "loom.scaffold-unexpanded": (p: { name: unknown }) =>
    `un-expanded scaffold primitive '${p.name}' — the scaffold macro could not resolve its ` +
    `target aggregate or workflow; check that the referenced symbol exists in the ` +
    `surrounding context.`,

  // --- the M-T9.56 drain of `match.ts` ------------------------------------
  "loom.unknown-permission": (p: { name: unknown }) =>
    `permissions.${p.name}: no permission named '${p.name}' is declared in this subdomain's 'permissions { ... }' block. ` +
    `Either add the declaration or fix the reference.`,
  // A `ui` is a system member, so it sees the union of every subdomain's
  // catalogue rather than one subdomain's — which means the name can fail to
  // resolve for a SECOND reason the context-scoped wording cannot express: two
  // subdomains declaring the same bare name give different runtime strings
  // (`sales.read` / `billing.read`), and binding the gate to whichever lowered
  // first would silently gate the page on the wrong subdomain's permission.
  "loom.unknown-permission#ui": (p: { name: unknown }) =>
    `permissions.${p.name}: no permission named '${p.name}' resolves from a 'ui'. ` +
    `A ui sees every subdomain's 'permissions { ... }' catalogue, so either no subdomain ` +
    `declares '${p.name}', or more than one does and the bare name is ambiguous — ` +
    `two subdomains declaring it produce different runtime strings. ` +
    `Declare it in exactly one subdomain, or rename so the gate names a single permission.`,

  // ----------------------------------------------------------------------
  // src/language/validators/types.ts
  // ----------------------------------------------------------------------
  // --- the M-T9.56 drain of `types.ts` ------------------------------------
  "loom.unknown-member": (p: { member: unknown; record: unknown }) =>
    `'${p.member}' is not a member of '${p.record}'.`,
  // A value-object / part FUNCTION called in a ui body.  The function exists
  // in the domain, but a frontend holds the record's WIRE shape — fields only —
  // so every frontend would emit a call to a method its record type lacks.
  "loom.unknown-member#ui-record-function": (p: { member: unknown; record: unknown }) =>
    `'${p.member}' is a function of '${p.record}', but a page, component or store holds ` +
    `'${p.record}' as its wire record, which carries fields only — no frontend can call ` +
    `'${p.member}()' on it.  Expose the value as a \`derived\` field (derived fields ship on ` +
    `the wire), or compute it in the ui from the record's fields.`,
  "loom.unknown-user-claim": (p: { member: unknown; claims: unknown }) =>
    `'${p.member}' is not a claim on the principal. 'currentUser' carries exactly the fields declared in the system's 'user { }' block (${p.claims}), plus the built-in 'isSystem'. Declare it ('${p.member}: <type>' inside 'user { }') or fix the spelling — an undeclared claim reaches the generated backend verbatim, whose 'UserClaims' shape is built from that same block, and breaks its own compile.`,
  "loom.unknown-user-claim#no-user-block": (p: { member: unknown }) =>
    `'currentUser.${p.member}' reads a claim, but the system declares no 'user { }' block, so the principal carries none. Declare it ('user { ${p.member}: <type> }', with 'auth' on the deployable that serves it); without a declaration the claim has no type, and its generated read is a guess.`,
  "loom.unknown-primitive-member": (p: { member: unknown; prim: unknown; known: unknown }) =>
    `'${p.member}' is not a member of '${p.prim}'. '${p.prim}' is a PRIMITIVE value, not a record — it has no fields.${p.known} An invented member is not caught anywhere downstream: it reaches the generated code verbatim, where node/.NET/Java fail their own compile and python/elixir do not — so an invariant written over one silently never fires.`,
  "loom.unknown-primitive-member#money": (p: { member: unknown; known: unknown }) =>
    `'${p.member}' is not a member of 'money'. 'money' is a PRIMITIVE — a precise decimal (decimal.js / decimal / BigDecimal / Decimal per backend), not a record: it carries an amount and nothing else, so it has no '.amount' and no '.currency' to read.${p.known} Compare or arithmetic the value directly ('limit > deductible'); if you wanted a record, declare one and use it as the field's type — 'valueobject Money { amount: money currency: string }'. Left un-rejected, '.${p.member}' reaches the generated code verbatim: node/.NET/Java fail their own compile, python/elixir do not, so an invariant over it silently never fires.`,
  "loom.unknown-primitive-member#json": (p: { member: unknown }) =>
    `'${p.member}' is not a member of 'json'. 'json' is an OPAQUE blob — Loom does not model its interior, so no member of it can be typed, validated, or rendered. Declare a 'valueobject' (or an entity part) when the shape is known, and keep 'json' for genuinely freeform payloads.`,
  "loom.unknown-primitive-member#file": (p: { member: unknown }) =>
    `'${p.member}' is not a member of 'File'. A 'File' field carries a wire-only REFERENCE — its '{ url, key, contentType, size }' shape is emitted at the boundary, but Loom does not expose those members to expressions on any backend, so '.${p.member}' would be rendered verbatim into code that has no such value. Pass the whole 'File' value to the primitive that renders it ('FileLink { a.attachment }' downloads it, 'FileUpload' writes it); if you need a member in domain logic, store it as its own field.`,

  // --- the M-T9.56 drain of `ui.ts` ---------------------------------------
  "loom.duplicate-action": (p: { name: unknown; surface: unknown }) =>
    `Duplicate action '${p.name}' on ${p.surface}; action names must be unique on a page/component.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/ui-framework-checks.ts — the two LiveView
  // component-HOISTING collisions (§18 emitter sentinels).  Both used to be a
  // bare `throw new Error` in `liveview-emit.ts`, raised mid-generate on a
  // `.ddd` that had just validated `0 error(s), 0 warning(s)`.
  // ----------------------------------------------------------------------
  "loom.duplicate-host-port": (p: { port: unknown; owners: unknown }) =>
    `Host port ${p.port} is published by more than one service (${p.owners}); ` +
    `\`docker compose up\` would abort with a port-in-use error. Give each deployable a ` +
    `distinct \`port:\`.`,
  "loom.duplicate-service-slug": (p: { names: unknown; slug: unknown }) =>
    `Deployables ${p.names} all resolve to the same ` +
    `docker-compose service slug '${p.slug}', so they would silently merge into one output ` +
    `directory and one compose service. Rename them to distinct slugs (names must differ by ` +
    `more than case / punctuation).`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/sensitivity-checks.ts
  // ----------------------------------------------------------------------
  "loom.duplicate-permission": (p: { name: unknown; pName: unknown }) =>
    `subdomain '${p.name}': permission '${p.pName}' is declared more than once.`,

  // --------------------------------------------------------------------
  // The BODY-WALKER GIVE-UP codes (M-T9.55).
  //
  // These four name the conditions under which the frontend body walker
  // declines to render a construct.  They are unusual in this catalog:
  // today they are attached at the EMISSION site (`giveUp()` in
  // `src/generator/_walker/give-up.ts` renders the code into the
  // `loom:unrendered [<code>] …` comment) rather than raised as a
  // diagnostic, because codegen has no diagnostic channel.  The wording
  // still lives here, for the one reason the catalog exists: the text a
  // user reads about a `loom.*` code must have exactly one home, whichever
  // phase puts it in front of them.  When `generate system` grows a
  // give-up-reporting pass these become ordinary reported diagnostics with
  // no change to the emitters.
  // --------------------------------------------------------------------
  "loom.unknown-page-element": (p: { where: unknown; name: unknown }) =>
    `\`${p.name}(…)\` names no walker primitive, component, value object, or ` +
    `\`extern\` function, so the frontend renders nothing for it — in a text slot the ` +
    `content is silently DROPPED (\`Text(${p.name}(…))\` emits an empty element).  Check the ` +
    `spelling, declare a \`component ${p.name}(…)\`, or import it as an \`extern\` function.`,
  // Same code, the case where the callee has no name to quote.  The leading
  // cause is a page `action` called with arguments (`onClick: pick("x")`) —
  // an action is passed BY NAME to an event slot and receives its payload
  // from the primitive, so the call form has no lowering and the frontend
  // renders nothing.
  // No `where` hole: unlike its sibling this message names nothing from the
  // model, and the CLI already prints the diagnostic's `source` ahead of the
  // text (`${d.code} ${d.source}: ${d.message}`).
  "loom.unknown-page-element#computed-callee":
    `a call in a rendered slot has a computed callee — the thing being called is ` +
    `an expression, not a name the walker can resolve, so the frontend renders nothing ` +
    `for it and in a text slot the content is silently DROPPED. The usual cause is ` +
    `calling a page \`action\` with arguments: an action is referenced BY NAME in an ` +
    `event slot (\`onClick: save\`) and takes its payload from the primitive, never ` +
    `\`onClick: save(x)\`. Pass the value through page \`state\` or the primitive's own ` +
    `props instead.`,
  "loom.unresolved-page-ref": (p: { where: unknown; name: unknown }) =>
    `\`${p.name}\` in a rendered slot names no route parameter, \`state\` field, ` +
    `\`derived\` binding, enclosing lambda parameter, or store field, so the frontend has ` +
    `nothing to read — the walker emits a COMMENT in its place and the content is silently ` +
    `DROPPED on every frontend (\`{/* ref: ${p.name} */}\` on React/Vue/Svelte/Angular, ` +
    `\`Html.none\` on Feliz, \`SizedBox.shrink()\` on Flutter).  Check the spelling, or declare ` +
    `\`${p.name}\` as page state / a route parameter.`,
  "loom.unresolved-action-ref#call-references-no-sibling": (p: { where: unknown; name: unknown }) =>
    `call \`${p.name}(…)\` references no sibling action and resolves to no ` +
    `function — declare an \`action ${p.name}(…)\` on this page/component, or fix the name.`,
  "loom.unresolved-action-ref#references-which-is-not": (p: {
    where: unknown;
    name: unknown;
    slot: unknown;
    argName: unknown;
  }) =>
    `\`${p.name} { ${p.slot}: ${p.argName} }\` references '${p.argName}', which is ` +
    `not a sibling action on this page/component — declare \`action ${p.argName}(…)\`, or fix the name.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/workflow-checks.ts
  // ----------------------------------------------------------------------
  "loom.duplicate-workflow": (p: { name: unknown; wfName: unknown }) =>
    `context '${p.name}': workflow '${p.wfName}' is declared more than once.`,

  // ----------------------------------------------------------------------
  // src/language/ddd-validator.ts
  // ----------------------------------------------------------------------
  "loom.validator-check-crashed": (p: { name: unknown; message: unknown }) =>
    `Validator check '${p.name}' crashed and was skipped; the remaining checks still ran. (${p.message})`,
  "loom.duplicate-auth-block": (p: { name: unknown }) =>
    `system '${p.name}' declares more than one 'auth { ... }' block; keep just the first.`,

  // --- the M-T9.56 drain of `ddd-validator.ts` ----------------------------
  // The four system-scope name-uniqueness rules plus the api → subdomain
  // resolution rule.  Four codes, not one: `ui` / `api` / `storage` /
  // `resource` are four declaration kinds with four different fix hints, and
  // the Problems panel dispatches on the code.
  "loom.duplicate-ui": (p: { name: unknown }) =>
    `Duplicate ui block '${p.name}'; ui names must be unique within a system.`,
  "loom.duplicate-api": (p: { name: unknown }) =>
    `Duplicate api '${p.name}'; api names must be unique within a system.`,
  "loom.duplicate-storage": (p: { name: unknown }) =>
    `Duplicate storage '${p.name}'; storage names must be unique within a system.`,
  "loom.duplicate-resource": (p: { name: unknown }) =>
    `Duplicate resource '${p.name}'; resource names must be unique within a system.`,

  // ----------------------------------------------------------------------
  // src/macros/expander.ts
  // ----------------------------------------------------------------------
  "loom.unknown-capability": (p: { cap: unknown }) =>
    `Unknown capability '${p.cap}' in 'implements'.`,
  "loom.unknown-macro#top-level": (p: { name: unknown; listMacroNames: unknown }) =>
    `Unknown macro or capability '${p.name}'.  Available macros: ${p.listMacroNames}.`,
  "loom.unknown-macro#nested": (p: {
    name: unknown;
    childName: unknown;
    listMacroNames: unknown;
  }) =>
    `Macro '${p.name}' invoked unknown macro '${p.childName}'.  ` +
    `Available: ${p.listMacroNames}.`,
  "loom.macro-target-mismatch": (p: { name: unknown; target: unknown; hostKind: unknown }) =>
    `Macro '${p.name}' targets '${p.target}' but was invoked on a '${p.hostKind}'.`,
  "loom.macro-threw#nested": (p: { childName: unknown; name: unknown; message: unknown }) =>
    `Macro '${p.childName}' (invoked from '${p.name}') threw: ${p.message}`,
  "loom.macro-threw#direct": (p: { name: unknown; message: unknown }) =>
    `Macro '${p.name}' threw during expansion: ${p.message}`,
  // Not a diagnostic of its own: the attribution any AST-phase diagnostic on a
  // macro-synthesised node is wrapped in (`DddDocumentValidator.toDiagnostic`),
  // which keeps that diagnostic's code and moves it onto the `with` clause.
  "loom.macro-synthesised": (p: { message: unknown; macro: unknown }) =>
    `${String(p.message).replace(/\.\s*$/, "")} (in code synthesised by '${p.macro}')`,
  "loom.macro-non-ast-result": (p: { v1: unknown }) =>
    `Macro returned a non-AST value (${p.v1}); expected an AST member or capability node.`,
  "loom.macro-escapes-host":
    "Macro emitted a node targeting a destination outside the host's subtree.  " +
    "Macros may only modify their host or its descendants (e.g. a context-level macro " +
    "may invoke an aggregate-level macro against an aggregate inside the context).",
  "loom.scaffold-aggregate-unserved": (p: { agg: unknown; context: unknown; repo: unknown }) =>
    `scaffoldHandlers/scaffoldApi skip aggregate '${p.agg}' in context '${p.context}': it has no ` +
    `repository, so nothing can load it by id and no handlers or routes are emitted for its ` +
    `operations, create, or destroy.  Add \`repository ${p.repo} for ${p.agg} { }\` to serve it.`,
  "loom.macro-arg-duplicate": (p: { name: unknown; macroName: unknown }) =>
    `Duplicate argument '${p.name}' in call to macro '${p.macroName}'.`,
  "loom.macro-arg-unknown": (p: { name: unknown; macroName: unknown; spec: unknown }) =>
    `Unknown argument '${p.name}' for macro '${p.macroName}'.  ` +
    `Declared parameters: ${p.spec}.`,
  "loom.macro-arg-missing": (p: { name: unknown; name2: unknown; kind: unknown }) =>
    `Macro '${p.name}' requires argument '${p.name2}' (kind=${p.kind}).`,
  "loom.macro-arg-unresolved-ref": (p: {
    argName: unknown;
    macroName: unknown;
    of: unknown;
    refText: unknown;
  }) =>
    `Argument '${p.argName}' to macro '${p.macroName}' references unknown ${p.of} '${p.refText}'.`,
  "loom.macro-arg-kind-mismatch": (p: { argName: unknown; macroName: unknown; kind: unknown }) =>
    `Argument '${p.argName}' to macro '${p.macroName}' expected kind '${p.kind}'.`,

  // ----------------------------------------------------------------------
  // src/api/evolve.ts
  // ----------------------------------------------------------------------
  "loom.ir-internal#snapshot-lowering": "Lowering failed before snapshot capture.",
  "loom.ir-internal#evolve-lowering": "Lowering the current source failed.",
  "loom.ir-internal#migration-derivation": (p: { message: unknown }) =>
    `Migration derivation failed: ${p.message}`,
  "loom.no-system":
    "Source has no `system` block — schema migrations and the wire contract are derived per system, so there is nothing to evolve yet.",

  // ----------------------------------------------------------------------
  // src/api/index.ts
  // ----------------------------------------------------------------------
  "loom.ir-internal#generation": (p: { err: unknown }) =>
    `IR phase failed before generation: ${p.err}`,

  // ----------------------------------------------------------------------
  // src/language/parse-errors.ts  (phase ①)
  // ----------------------------------------------------------------------
  // Chevrotain's own text for this is a numbered dump of every lookahead
  // path it considered — 14 lines for a mistyped design pack, over a hundred
  // in a member position.  Every alternation the author can hit is a CLOSED
  // SET, so the reply is the nearest legal spelling plus a sample of the set.
  "loom.parse-error#unexpected-token": (p: {
    found: unknown;
    suggestion: unknown;
    candidates: unknown;
  }) => `Unexpected '${p.found}'.${p.suggestion} Expected one of: ${p.candidates}.`,
  // A keyword sitting where a NAME was expected.  Chevrotain's own wording
  // ("Expecting token of type 'ID' but found `slot`") describes the token
  // stream, not the author's mistake — it never says the word is spoken for,
  // so the reader has no way to tell a typo from a word Loom has taken (audit
  // #2864 § Papercuts).  Naming the remedy matters as much as naming the
  // cause: renaming is the whole fix, and it is not obvious one is needed.
  //
  // "keyword … here" rather than "reserved word", deliberately.  Most of
  // Loom's keywords are SOFT — reserved only where their own rule begins — so
  // a word refused in this position is often perfectly legal as a name three
  // lines up (`page` is a field name but not a `derived` name).  Claiming it
  // is reserved outright would send the author looking for a rule that does
  // not exist.
  "loom.parse-error#reserved-name": (p: { found: unknown; expected: unknown }) =>
    `'${p.found}' is a Loom keyword, so it cannot be used as a ${p.expected} here. ` +
    `Rename it — '${p.found}Ref' or a domain-specific synonym.`,
  // The ASYMMETRIC half of the reserved-word case: a keyword the grammar
  // admits where a name is DECLARED (`LooseName`) but not where one is READ
  // (`NameRefIdent`).  The declaration is accepted, so the author has no
  // reason to suspect the name — and the failure lands on the USE, in an
  // alternation whose candidate dump describes expression syntax.  Naming the
  // asymmetry is the only thing that makes the refusal learnable; `from` works
  // as a parameter and `to` works everywhere, so there is otherwise no rule to
  // infer.  The set is derived from the grammar (`src/language/soft-keywords.ts`).
  "loom.parse-error#reserved-in-expression": (p: { found: unknown }) =>
    `'${p.found}' is a Loom keyword and cannot be READ as a name, even though it ` +
    `is accepted where a name is DECLARED — so a parameter, field or binding ` +
    `called '${p.found}' parses and can then never be mentioned. Rename it.`,
  // A declaration one scope off — `migration` inside `system { … }`,
  // `aggregate` straight in a `system`, `deployable` inside a `context`.  The
  // enclosing block's member loop exits, so chevrotain's own text is
  // "Expecting token of type '}' but found `migration`" — an unbalanced-brace
  // reading of a file whose braces are fine.  Say where the declaration
  // belongs and how to move it there; the valid scopes are derived from the
  // grammar (`src/language/misplaced-declaration.ts`).
  // A vendor setting written beside `type:` in a `storage` block.  The block
  // takes a fixed clause set and every vendor parameter is a `config` entry,
  // so the remedy is to move the key — not to rename it (which is what the
  // reserved-name text would say for `from`), and not to balance a brace
  // (which is what chevrotain's "Expecting '}'" suggests for `bucket`).
  "loom.parse-error#storage-config-key": (p: {
    key: unknown;
    storage: unknown;
    clauses: unknown;
  }) =>
    `'${p.key}' is not a clause of \`storage ${p.storage}\` (it takes ${p.clauses}) — ` +
    `vendor settings go inside its config map: \`config: { ${p.key}: … }\`.`,
  "loom.parse-error#misplaced-declaration": (p: {
    keyword: unknown;
    where: unknown;
    notHere: unknown;
    remedy: unknown;
  }) => `'${p.keyword}' declarations belong ${p.where}${p.notHere} — ${p.remedy}.`,
  // An access modifier after the field's default — `status: S = Draft
  // managed`.  The property ends at the default and the modifier is read as
  // the next field's NAME, so chevrotain reports "Expecting ':'" on the line
  // below.  Say the order (`src/language/parse-errors.ts`).
  "loom.parse-error#access-modifier-after-default": (p: { modifier: unknown; fixed: unknown }) =>
    `The access modifier '${p.modifier}' goes before the default: \`${p.fixed}\`.`,
  // A `find` declared in a repository body — the declaration was removed
  // (D-FINDDECL-REMOVED): every read is the repository contract
  // (`src/language/parse-errors.ts`).
  "loom.parse-error#find-removed": (p: { repository: unknown; aggregate: unknown }) =>
    `A repository declares no \`find\`s any more: read '${p.aggregate}' through the ` +
    `repository contract instead — \`${p.repository}.find(id)\` / \`get(id)\`, ` +
    `\`${p.repository}.findBy(<column>: v)\` / \`getBy(…)\` over a declared \`unique (…)\` key, ` +
    `or a \`criterion\` read with \`${p.repository}.find(C)\` (the first match) or ` +
    `\`all(C)\`. A read a client calls is a \`queryHandler\` or ` +
    `\`scaffoldGet\`. Leave the repository body empty (\`repository ${p.repository} for ${p.aggregate}\`).`,
  // An anonymous `retrieval { … }` literal — removed (D-REPO-VERBS): its
  // criterion and `sort:` are arguments of `all` (`src/language/parse-errors.ts`).
  "loom.parse-error#retrieval-literal-removed":
    "The anonymous `retrieval { where: C sort: […] }` literal is no longer part of the language: " +
    "pass the criterion and its order to `all` instead — `Orders.all(C, sort: [placedAt desc], " +
    "page: { limit: 20 })`. A reusable shape is a declared `retrieval`, run with " +
    "`Orders.all(MyRetrieval(args))`. `node scripts/codemod-repo-verbs.mjs` migrates a whole tree.",
  // A workflow `handle` member — the declaration was removed (D-HANDLE-REMOVAL):
  // it had no correlation surface and no backend ever routed it.  The named
  // command entry is a context-level `commandHandler` (`src/language/parse-errors.ts`).
  "loom.parse-error#workflow-handle-removed": (p: { workflow: unknown; handler: unknown }) =>
    `workflow '${p.workflow}': 'handle ${p.handler}(…)' is no longer part of the language. ` +
    `A named command entry is a context-level \`commandHandler ${p.handler}(…) { … }\` — move ` +
    `it out of the workflow (\`node scripts/codemod-workflow-handle.mjs\` does it for a whole ` +
    `project, and names any handle it cannot lift).`,
} satisfies Record<string, MessageEntry>;

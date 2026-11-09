// The `auth` family of the diagnostic-message catalog: auth, authorization policies, permissions, `requires` gates, field masks, sensitivity and auditing.
//
// A code lives in the family that owns its first segment (`loom.<segment>-…`),
// listed in `segments` below; `../messages.ts` merges every family into
// `DIAGNOSTIC_MESSAGES`, and `test/system/diagnostic-catalog.test.ts` fails on a
// key filed under the wrong family.  A code with a brand-new first segment adds
// that segment to the family it belongs with.

import type { MessageEntry } from "./_shared.js";

/** The code first-segments this family owns. */
export const segments = [
  "policy",
  "auth",
  "permission",
  "requires",
  "mask",
  "sensitive",
  "sensitivity",
  "user",
  "current",
  "currentuser",
  "audit",
  "audited",
  "guard",
  "default",
  "field",
] as const;

export const messages = {
  // ----------------------------------------------------------------------
  // src/language/validators/_shared.ts
  // ----------------------------------------------------------------------
  // `warnSensitivityDrop` is ONE forwarding helper called from every
  // assignment / default / emit / derived type check, so the drain (M-T9.56)
  // touched the helper, not its callers.
  "loom.sensitivity-drop": (p: { dropped: unknown; actual: unknown; expected: unknown }) =>
    `Implicit conversion drops sensitivity tag(s) {${p.dropped}}: '${p.actual}' flows into '${p.expected}'.`,

  // ----------------------------------------------------------------------
  // src/language/validators/auth.ts
  // ----------------------------------------------------------------------
  "loom.auth-without-user":
    "auth block requires a `user { … }` block to define the identity shape.",
  "loom.auth-unknown-provider": (p: { provider: unknown; knownProviders: unknown }) =>
    `unknown auth provider '${p.provider}'.  Known providers: ${p.knownProviders} (or omit \`provider:\` and supply a raw \`oidc { issuer }\`).`,
  "loom.auth-missing-issuer": (p: { selfHosted: unknown; provider: unknown }) =>
    p.selfHosted
      ? `provider '${p.provider}' is self-hosted and requires an \`oidc { issuer: … }\` block.`
      : 'oidc requires an `issuer` (env-bound).  Add an `oidc { issuer: env("OIDC_ISSUER") }` block.',
  "loom.auth-missing-client-id":
    'oidc requires a `clientId` (env-bound).  Add `clientId: env("OIDC_CLIENT_ID")` to the `oidc { … }` block.',
  "loom.auth-unknown-claim-field": (p: { field: unknown }) =>
    `claim mapping targets unknown user field '${p.field}'.`,
  "loom.auth-oidc-no-audience":
    'oidc declares no `audience:`, so the generated verifier skips the `aud` check — ANY token the issuer minted, for ANY client of that issuer, is accepted. Declare `audience: env("OIDC_AUDIENCE")` (or a literal) in the `oidc { … }` block, or leave it undeclared and set OIDC_AUDIENCE in the deploy environment — all five backends read that variable. Silence this by declaring one either way.',

  // ----------------------------------------------------------------------
  // src/language/validators/deployable.ts
  // ----------------------------------------------------------------------
  "loom.auth-ui-target-open": (p: { name: unknown; targetName: unknown }) =>
    `Frontend deployable '${p.name}' declares 'auth: ui' but its target '${p.targetName}' is not 'auth: required'; the guard has no session endpoint to probe.`,
  "loom.auth-ui-misplaced": (p: { name: unknown }) =>
    `Deployable '${p.name}' declares 'auth: ui', which is only valid on a frontend deployable; backends use 'auth: required'.`,

  // ----------------------------------------------------------------------
  // src/language/validators/i18n-strings.ts
  // ----------------------------------------------------------------------
  "loom.user-visible-concat": (p: { type: unknown }) =>
    `String concatenation in a user-visible '${p.type}' slot won't translate to languages with different word order, plural rules, or formatting. ` +
    'Use a backtick template interpolation — e.g. `Order {order.id}` rather than "Order " + order.id.',

  // ----------------------------------------------------------------------
  // src/language/validators/permissions.ts
  // ----------------------------------------------------------------------
  "loom.permission-implies-self": (p: { name: unknown }) =>
    `permission '${p.name}' cannot 'implies' itself.`,
  "loom.permission-implies-unknown": (p: { name: unknown; target: unknown; subName: unknown }) =>
    `permission '${p.name}' implies '${p.target}', which is not a permission declared ` +
    `in subdomain '${p.subName}'. Declare it in a 'permissions { … }' block, or fix the name.`,

  // ----------------------------------------------------------------------
  // src/language/validators/policy-fn.ts
  // ----------------------------------------------------------------------
  "loom.policy-fn-return-type": (p: { name: unknown }) =>
    `policy function '${p.name}' must return 'bool' — an authorization predicate is a boolean point gate.`,
  "loom.policy-fn-cycle": (p: { name: unknown }) =>
    `policy function '${p.name}' is part of a reference cycle. A policy function may not (transitively) reference itself.`,
  // A policy-function call from a context other than its declaring one (eval
  // item 39, ruling D9).  Policies are context-local; sharing one across
  // contexts is a separate mission.
  "loom.policy-out-of-scope": (p: { name: unknown; declaredIn: unknown; usedIn: unknown }) =>
    `policy '${p.name}' is declared in context '${p.declaredIn}'; policies are context-local — ` +
    `redeclare it in '${p.usedIn}' to call it there.`,
  // The same rule reached through a top-level function: its body is inlined at
  // each call site, so a policy it names must be declared in the CALLING context.
  "loom.policy-out-of-scope#via-function": (p: {
    fn: unknown;
    name: unknown;
    declaredIn: unknown;
    usedIn: unknown;
  }) =>
    `function '${p.fn}' calls policy '${p.name}', which is declared in context '${p.declaredIn}'; ` +
    `policies are context-local and a top-level function is inlined where it is called — ` +
    `redeclare '${p.name}' in '${p.usedIn}' to call '${p.fn}' there.`,
  "loom.policy-fn-arity": (p: {
    argc: unknown;
    name: unknown;
    want: unknown;
    want2: unknown;
    got: unknown;
    got2: unknown;
  }) =>
    p.argc
      ? `policy function '${p.name}' expects ${p.want} argument${p.want2}; reference it as '${p.name}(…)'.`
      : `policy function '${p.name}' expects ${p.want} argument${p.want2}, but ${p.got} ${p.got2} supplied.`,

  // --- the M-T9.56 drain of `statements.ts` -------------------------------
  // The three "modifier on a PRIVATE operation" warnings.  They stay three
  // codes because each names a different thing the private operation loses;
  // the shared half ("no HTTP entry point") is the reason, not the rule.
  "loom.audited-private-operation": (p: { name: unknown }) =>
    `'audited' has no effect on private operation '${p.name}' — it has no HTTP entry point, so no audit record is produced.`,
  "loom.requires-private-operation": (p: { name: unknown }) =>
    `'requires' has no effect on private operation '${p.name}' — it has no HTTP entry point, so no authorization gate is emitted.`,
  // ONE code for the `requires` gate at all five sites that used to word it
  // separately — the operation gate (`statements.ts`), the in-body `requires`
  // statement (`statements.ts` and the workflow/handler twin in `types.ts`),
  // the read-path find/projection gate (`repository.ts`) and the member gate
  // (`structural.ts`).  It is literally the same rule; five uncoded copies of
  // one sentence is exactly what the catalog exists to end.
  "loom.requires-not-bool": (p: { actual: unknown }) =>
    `'requires' must be of type 'bool', got '${p.actual}'.`,

  // ----------------------------------------------------------------------
  // src/language/validators/structural.ts
  // ----------------------------------------------------------------------
  // --- the M-T9.56 drain of `structural.ts` -------------------------------
  // The aggregate-shape rules the wording catalog never saw: an inert
  // `audited`, the two duplicate-member rules, and the three containment
  // rules.
  "loom.audited-no-command": (p: { name: unknown }) =>
    `'audited' on aggregate '${p.name}' has no effect — it declares no public command action (operation, create, or destroy), so no audit record is ever produced.`,

  // --- the M-T9.56 drain of `match.ts` ------------------------------------
  "loom.field-default-not-constant": (p: { owner: unknown; name: unknown; found: unknown }) =>
    `default for '${p.owner}.${p.name}' reads ${p.found}, but a field default is evaluated where no instance exists yet — ` +
    `notably the create-request wire schema, which every client sees. ` +
    `Write it as 'derived ${p.name}: … = …' if it is computed from other fields, or give the field an instance-independent default.`,
  "loom.currentuser-not-in-request-scope": (p: { location: unknown }) =>
    `currentUser is only available in per-request handlers (operations, workflows, repository find where filters). ` +
    `Found in ${p.location}; remove the reference or move the logic into a per-request body.`,

  // ----------------------------------------------------------------------
  // src/language/validators/types.ts
  // ----------------------------------------------------------------------
  // --- the M-T9.56 drain of `types.ts` ------------------------------------
  "loom.mask-unless-not-bool": (p: { name: unknown; actual: unknown }) =>
    `'mask unless' on '${p.name}' must be of type 'bool', got '${p.actual}'.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/query-checks.ts
  // ----------------------------------------------------------------------
  "loom.policy-read-gate-not-current-user": (p: {
    name: unknown;
    aggregate: unknown;
    offending: unknown;
  }) =>
    `policy in context '${p.name}': \`read ${p.aggregate} requires …\` runs before the load ` +
    `(no row exists yet), so it may only reference \`currentUser\` (and constants) — ` +
    `\`${p.offending}\` is not available here. Scope which rows return with a capability ` +
    "`filter` or a criterion; use the read gate to allow / deny the caller.",

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/ui-framework-checks.ts — the two LiveView
  // component-HOISTING collisions (§18 emitter sentinels).  Both used to be a
  // bare `throw new Error` in `liveview-emit.ts`, raised mid-generate on a
  // `.ddd` that had just validated `0 error(s), 0 warning(s)`.
  // ----------------------------------------------------------------------
  "loom.current-user-needs-auth-ui": (p: { what: unknown; uiName: unknown; dName: unknown }) =>
    `${p.what} on ui '${p.uiName}' reads 'currentUser', but deployable '${p.dName}' binds no verified session user, so the read emits a dangling reference (react 'undefined.<claim>', invalid Dart on flutter, an unbound match on feliz). Add the auth guard: 'auth: ui' on a frontend deployable, or 'auth: required' on a fullstack deployable that mounts the ui itself.`,
  "loom.auth-ui-unsupported-framework": (p: {
    name: unknown;
    uiFramework: unknown;
    frameworks: unknown;
  }) =>
    `Deployable '${p.name}': 'auth: ui' is currently only supported on ${p.frameworks} frontends; framework '${p.uiFramework}' isn't supported yet.`,
  "loom.default-deny-ungated#denybydefault-is-reachable": (p: { name: unknown; opName: unknown }) =>
    `denyByDefault: '${p.name}.${p.opName}' is reachable on an 'auth: required' deployable but declares no \`requires\` gate. Add a \`requires <expr>\` (use \`requires true\` to allow anonymous access).`,
  // Same rule, but the member is a `create` / `destroy`, whose gate is the first
  // STATEMENT of the body rather than a header clause.  The generic arm above
  // says "add a `requires <expr>`" without saying where, and every SIBLING
  // declaration (`operation` / `find` / `projection` / `handle`) takes one in the
  // header — so an author follows the instruction into
  // `create(...) requires P() { }`, gets `Expecting token of type '{' but found
  // \`requires\``, and concludes the posture is unsatisfiable.  That is not a
  // hypothetical: it is how finding F-004 reached "denyByDefault and
  // persistedAs: eventLog are mutually exclusive", a claim that was false for the
  // state-based case the whole time.  Name the position and the trap closes.
  "loom.default-deny-ungated#denybydefault-lifecycle-is-reachable": (p: {
    name: unknown;
    opName: unknown;
    label: unknown;
  }) =>
    `denyByDefault: '${p.name}.${p.opName}' is reachable on an 'auth: required' deployable but ` +
    `declares no \`requires\` gate. A \`${p.label}\` gate is the FIRST STATEMENT of the body, ` +
    `not a header clause — write \`${p.label}(...) { requires <expr> ... }\` ` +
    `(\`${p.label}(...) requires <expr> { }\` is a parse error; only \`operation\` / \`find\` / ` +
    `\`projection\` / \`handle\` take \`requires\` in the header). Use \`requires true\` to allow ` +
    `anonymous access.`,
  // Same rule, but the member came from a MACRO — so there is no declaration
  // header in the `.ddd` to add a `requires` to, and naming the member alone
  // sends the author looking for a line that does not exist.  Name the macro
  // call they DO own, and the parameter that carries the gate.
  "loom.default-deny-ungated#denybydefault-is-reachable-macro": (p: {
    name: unknown;
    opName: unknown;
    macroName: unknown;
  }) =>
    `denyByDefault: '${p.name}.${p.opName}' is reachable on an 'auth: required' deployable but declares no \`requires\` gate. Its body comes from \`with ${p.macroName}(...)\`, so there is no member here to add one to — name the gate as a \`policy\` and hand it to the macro (\`with ${p.macroName}(requires: <Policy>)\`), or drop \`with ${p.macroName}\` and hand-write the member with its own \`requires\`.`,
  "loom.default-deny-ungated#denybydefault-workflow": (p: { label: unknown }) =>
    `denyByDefault: workflow '${p.label}' is reachable on an 'auth: required' deployable but declares no \`requires\` gate. Add a \`requires <expr>\` (use \`requires true\` to allow anonymous access).`,
  "loom.default-deny-ungated#denybydefault-find-is-reachable": (p: {
    name: unknown;
    findName: unknown;
    aggregate: unknown;
  }) =>
    `denyByDefault: find '${p.name}.${p.findName}' is reachable on an 'auth: required' deployable but '${p.aggregate}' has no read gate. Add \`policy { read ${p.aggregate} requires <expr> }\` to its context — it gates every read of '${p.aggregate}' (use \`requires true\` to allow anonymous access).`,
  // The SYNTHESISED by-id read under denyByDefault: REFUSED AT RUNTIME (403)
  // unless the aggregate has a `policy { read X requires <expr> }` gate.  A
  // WARNING for one release (owner decision 2026-10-11) so existing models
  // keep building; promoted to an error in a later release.
  "loom.default-deny-by-id-ungated": (p: { name: unknown; path: unknown }) =>
    `denyByDefault: the by-id read '${p.path}' on aggregate '${p.name}' has no read gate, ` +
    `so it is now REFUSED AT RUNTIME (403) for every caller. To serve it, add ` +
    `\`policy { read ${p.name} requires <expr> }\` to its context — it gates every read of ` +
    `'${p.name}' (use \`requires true\` to make it intentionally public), or set ` +
    `\`enforcement: opt\`. This warning becomes an error in a later release.`,
  // The aggregate LIST read under denyByDefault (eval item 22, ruling D5).
  // Same tier and same promotion plan as the by-id read above.
  "loom.default-deny-list-ungated": (p: { name: unknown; path: unknown }) =>
    `denyByDefault: the list read 'GET ${p.path}' on aggregate '${p.name}' has no read ` +
    `gate, so it is now REFUSED AT RUNTIME (403) for every caller. To serve it, add ` +
    `\`policy { read ${p.name} requires <expr> }\` to its context — it gates every read of ` +
    `'${p.name}' (use \`requires true\` to mark it intentionally public), or set ` +
    `\`enforcement: opt\`. This warning becomes an error in a later release.`,
  // An event-sourced `create` under denyByDefault.  A WARNING with its own code,
  // for RECOURSE (the reason the by-id read was a warning until M-T3.19 gave it
  // a surface): the author cannot gate this one — a body `requires` here is refused outright by
  // `loom.target-unsupported#lifecycle-guard-event-sourced`, so demanding one would be an
  // unsatisfiable error.  See the long-form reason at the call site in
  // `default-deny-checks.ts`.
  "loom.default-deny-es-create-ungateable": (p: {
    name: unknown;
    opName: unknown;
    path: unknown;
  }) =>
    `denyByDefault: '${p.name}.${p.opName}' serves \`POST ${p.path}\` to ANY authenticated ` +
    `caller, and it cannot be gated where it is declared: '${p.name}' is ` +
    `\`persistedAs: eventLog\`, and a \`requires\` in an event-sourced \`create\` body is ` +
    `refused (\`loom.target-unsupported#lifecycle-guard-event-sourced\`) because that body renders into the ` +
    `domain \`_init\`, which has no principal in scope. This is a WARNING rather than an ` +
    `error precisely because there is no \`requires\` you could add — erroring would make ` +
    `every event-sourced aggregate with a creation endpoint unbuildable under ` +
    `\`denyByDefault\`. To close it today: issue the create from a gated \`operation\` (or ` +
    `\`workflow\`) that carries the \`requires\`, and keep the canonical \`create\` off the ` +
    `client — or host '${p.name}' on a deployable whose whole api is restricted. Making the ` +
    `event-sourced create route gateable in place is mission M-T3.16.`,
  "loom.default-deny-ungated#denybydefault-projection": (p: { name: unknown }) =>
    `denyByDefault: projection '${p.name}' is served as a read endpoint on an 'auth: required' deployable but declares no \`requires\` gate. Add a \`requires <expr>\` after its declaration header (use \`requires true\` to allow anonymous access).`,
  // Same rule, but the projection came from a MACRO (`scaffoldDashboard`),
  // which copies the source aggregate's policy read gate onto it — so the
  // missing gate is that policy rule, and the fix is to write it.
  "loom.default-deny-ungated#denybydefault-projection-macro": (p: {
    name: unknown;
    macroName: unknown;
    source: unknown;
  }) =>
    `denyByDefault: projection '${p.name}' (from \`with ${p.macroName}\`) is served as a read endpoint on an 'auth: required' deployable but has no read gate — it summarises '${p.source}', which declares no \`policy { read ${p.source} requires <expr> }\` rule. Add that rule to the context: \`${p.macroName}\` copies it onto the projection, and it gates every other read of '${p.source}' too (use \`requires true\` to allow anonymous access).`,
  "loom.default-deny-ungated#denybydefault-workflow-instances": (p: { name: unknown }) =>
    `denyByDefault: workflow '${p.name}' serves its instance reads (\`/workflows/${String(p.name).toLowerCase()}/instances\`) on an 'auth: required' deployable but declares no \`requires\` gate. Add a \`requires <expr>\` to the workflow header (use \`requires true\` to allow anonymous access) — it gates the READS; the command entries keep their own body gates.`,
  "loom.default-deny-ungated#denybydefault-handler": (p: {
    kind: unknown;
    ctx: unknown;
    handler: unknown;
    method: unknown;
    path: unknown;
  }) =>
    `denyByDefault: ${p.kind} '${p.ctx}.${p.handler}' is bound to \`route ${p.method} "${p.path}"\` on an 'auth: required' deployable but declares no \`requires\` gate. Add a \`requires <expr>\` to its body (use \`requires true\` to allow anonymous access).`,
  "loom.default-deny-ungated#denybydefault-handler-extern": (p: {
    kind: unknown;
    ctx: unknown;
    handler: unknown;
    method: unknown;
    path: unknown;
  }) =>
    `denyByDefault: ${p.kind} '${p.ctx}.${p.handler}' is \`extern\` — it has no body, so it cannot carry a \`requires\` gate — yet it is bound to \`route ${p.method} "${p.path}"\` on an 'auth: required' deployable. Give it a body (drop \`extern\`) so it can declare a gate, or remove the route binding.`,
  "loom.audit-history-ungated": (p: { aggregateName: unknown; aggregateName2: unknown }) =>
    `denyByDefault: '${p.aggregateName}' is \`audited\`, so it serves \`GET /${p.aggregateName2}/{id}/history\`, but '${p.aggregateName}' has no read gate — the change history is reachable by any authenticated caller. Add \`policy { read ${p.aggregateName} requires <expr> }\` to its context; history is one of the reads it gates (use \`requires true\` to allow anonymous access).`,
  // M-T6.33.  Two lifecycle-stamp refusals, neither of them backend-specific:
  // the check reads only the model (auth presence, persistedAs).  They were
  // INVISIBLE to this catalog gate until M-T6.33 — the five old per-backend
  // codes were emitted as `code: backend.code` (a property access), and the
  // scanner only records sites whose `code:` is a string literal.
  // The guard sibling of the filter/stamp principal-without-auth pair.  Its
  // consequence is sharper than theirs — the gate is EMITTED, as a free
  // identifier, so the generated project does not compile (TS2304 / CS0103 /
  // `cannot find symbol` / an unbound name in the FastAPI route).
  "loom.guard-principal-without-auth": (p: {
    dep: unknown;
    family: unknown;
    ctxName: unknown;
    site: unknown;
    principalNoun: unknown;
  }) =>
    `Deployable '${p.dep}' (platform ${p.family}) hosts '${p.ctxName}.${p.site}' with a ` +
    `\`requires\` gate that references currentUser, but the deployable has no auth — there is ` +
    `no request-scoped ${p.principalNoun} to evaluate it against, so the gate is emitted as an ` +
    `unbound identifier and the generated project does not compile. Add 'auth: required' (and a ` +
    `system 'user {}' block), or drop the principal reference from the gate.`,
  "loom.field-mask-principal-without-auth": (p: {
    dep: unknown;
    family: unknown;
    ctxName: unknown;
    field: unknown;
    principalNoun: unknown;
  }) =>
    `Deployable '${p.dep}' (platform ${p.family}) hosts field '${p.ctxName}.${p.field}' with a ` +
    `\`mask unless\` predicate that references currentUser, but the deployable has no auth — ` +
    `there is no request-scoped ${p.principalNoun} to evaluate it against, so the field could ` +
    `only ever read as null and the emitted redaction does not compile or boot. Add ` +
    `'auth: required' (and a system 'user {}' block), or drop the mask.`,
  "loom.field-mask-not-current-user": (p: { name: unknown; fName: unknown; offending: unknown }) =>
    `aggregate '${p.name}' field '${p.fName}': a \`mask unless\` predicate is evaluated ` +
    `at read projection as a param-free caller check, so it may only reference \`currentUser\` ` +
    `(and constants) — \`${p.offending}\` is not available here.`,
  "loom.field-mask-unsupported": (p: { name: unknown; names: unknown }) =>
    `aggregate '${p.name}' has \`mask unless\` field(s) ${p.names}, but no backend ` +
    `deployable hosts this context, so read-mask redaction is not emitted and the field would ` +
    `ship unredacted. Host the context on a backend deployable, or drop the \`mask unless\` ` +
    `clause (authorization.md §5).`,
  "loom.field-mask-event-channel": (p: { event: unknown; channel: unknown; field: unknown }) =>
    `event '${p.event}' carries the \`mask unless\` field '${p.field}' and is published on ` +
    `channel '${p.channel}' — a channel message is delivered to every subscriber unredacted (no ` +
    `principal is in scope on the consuming side), so the masked value would leave the read ` +
    `boundary. Emit a redacted or derived value instead (an id, a bucket, a boolean), or take the ` +
    `event off the channel.`,
  "loom.field-mask-unique-oracle": (p: { name: unknown; field: unknown }) =>
    `aggregate '${p.name}' declares a \`unique\` key on the \`mask unless\` field '${p.field}', ` +
    `so its create answers 409 when a guessed value already exists — an existence oracle on a ` +
    `value the caller cannot read. Gate the create with a \`requires\` that includes the mask ` +
    `predicate, or drop the field from the key.`,
  "loom.field-mask-projection-source": (p: { name: unknown; src: unknown; via?: unknown }) =>
    `projection '${p.name}' ${p.via === "join" ? `joins` : `sources from`} aggregate '${p.src}', ` +
    `which has a \`mask unless\` field — query-time projection responses are not yet read-masked, ` +
    `so this would expose the masked field. Read the aggregate through its own routes, or drop ` +
    `the mask.`,
  "loom.field-mask-projection-source#fold": (p: {
    name: unknown;
    event: unknown;
    field: unknown;
  }) =>
    `projection '${p.name}' folds event '${p.event}', whose emitted payload carries the ` +
    `\`mask unless\` field '${p.field}' — a projection row is served unredacted (no mask marker, ` +
    `no principal in scope on its read routes), so folding the masked value launders it into ` +
    `cleartext. Emit a redacted or derived value instead (an id, a bucket, a boolean), or drop ` +
    `the mask.`,
  "loom.audited-backend-unsupported": (p: { name: unknown; kind: unknown; names: unknown }) =>
    `aggregate '${p.name}' has 'audited' ${p.kind}(s) ${p.names}, but no backend deployable ` +
    `hosts this context, so no audit record is emitted for them. Host the context on a backend ` +
    `deployable, or drop the 'audited' modifier. Tracked in audit-and-logging.md.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/sensitivity-checks.ts
  // ----------------------------------------------------------------------
  "loom.sensitive-wire-unsupported": (p: { field: unknown; aggregate: unknown; tags: unknown }) =>
    `'${p.aggregate}.${p.field}' is declared \`sensitive(${p.tags})\`, and that tag reaches ` +
    `exactly one consequence today: the synthesized \`inspect\` prints \`<redacted>\` instead ` +
    `of the value on all five backends.  It does NOT reach the wire — every backend builds ` +
    `the response DTO from the wire shape with no sensitivity arm, so this field is ` +
    `serialized in cleartext to any caller allowed to read '${p.aggregate}', and it is ` +
    `unmarked in logs, events and outbound resource calls.  To redact it on a read TODAY, ` +
    `add \`mask unless <predicate>\`, or mark the field \`internal\` / \`secret\` so it is ` +
    `not served at all.`,
  "loom.user-duplicate-field": (p: { name: unknown; fName: unknown }) =>
    `system '${p.name}': user block declares field '${p.fName}' more than once.`,
  "loom.user-reserved-field": (p: { name: unknown; fName: unknown }) =>
    `system '${p.name}': user block declares field '${p.fName}', but that name is reserved for the ` +
    `built-in system principal (\`currentUser.isSystem\`, and \`causedBy\` — the originating user an ` +
    `event reactor records for audit).  Rename the claim.`,
  "loom.auth-no-user-block": (p: { name: unknown; sysName: unknown }) =>
    `deployable '${p.name}' has 'auth: required' but system '${p.sysName}' declares no 'user { ... }' block. ` +
    `Add a system-level user block describing the JWT claim shape (e.g. 'user { id: string, role: string }').`,

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
  "loom.user-component-deferred-target": (p: {
    name: unknown;
    uiName: unknown;
    framework: unknown;
    dName: unknown;
    reason: unknown;
    emitter: unknown;
  }) =>
    `component '${p.name}' on ui '${p.uiName}': the ${p.framework} component emitter DEFERS ` +
    `this component — ${p.reason} — so it is rendered by deployable '${p.dName}' as NOTHING: ` +
    `no component is emitted for it, and every call site renders the walker's ` +
    `\`unknown layout component: ${p.name}\` give-up comment.  The declaration and its uses ` +
    `disappear together, with a clean build (${p.emitter}).  Change the component to a shape ` +
    `this frontend emits, or host this ui on a frontend that renders it ` +
    `(React / Vue / Svelte all do).`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/tenancy-checks.ts
  // ----------------------------------------------------------------------
  "loom.policy-duplicate-target#read": (p: {
    name: unknown;
    aggregate: unknown;
    source: unknown;
  }) =>
    `policy in context '${p.name}' selects a read level for '${p.aggregate}' more ` +
    `than once (\`${p.source}\`); keep exactly one \`allow … on ${p.aggregate}\`.`,
  "loom.policy-duplicate-target#read-gate": (p: { name: unknown; aggregate: unknown }) =>
    `policy in context '${p.name}' declares \`read ${p.aggregate} requires …\` more than ` +
    `once; keep exactly one read gate per aggregate (combine the conditions with \`||\` / \`&&\`).`,
  "loom.policy-duplicate-target#write": (p: {
    name: unknown;
    aggregate: unknown;
    source: unknown;
  }) =>
    `policy in context '${p.name}' selects a write level for '${p.aggregate}' more ` +
    `than once (\`${p.source}\`); keep exactly one \`allow write … on ${p.aggregate}\`.`,
  "loom.policy-unknown-aggregate#read": (p: {
    name: unknown;
    source: unknown;
    aggregate: unknown;
  }) =>
    `policy in context '${p.name}': \`${p.source}\` names '${p.aggregate}', which ` +
    `is not an aggregate in this context.  A read level scopes a tenant-owned aggregate ` +
    `declared in the same context.`,
  "loom.policy-unknown-rule": (p: { word: unknown }) =>
    `'${p.word}' does not start a policy rule — a \`policy { }\` block holds \`allow …\`, ` +
    `\`deny …\` and \`read <Aggregate> requires <expr>\` rules.`,
  "loom.policy-unknown-aggregate#read-gate": (p: { name: unknown; aggregate: unknown }) =>
    `policy in context '${p.name}': \`read ${p.aggregate} requires …\` names ` +
    `'${p.aggregate}', which is not an aggregate in this context.  A read gate covers the ` +
    `reads of an aggregate declared in the same context.`,
  "loom.policy-unknown-aggregate#write": (p: {
    name: unknown;
    source: unknown;
    aggregate: unknown;
  }) =>
    `policy in context '${p.name}': \`${p.source}\` names '${p.aggregate}', which ` +
    `is not an aggregate in this context.  A write level scopes a tenant-owned aggregate ` +
    `declared in the same context.`,
  "loom.policy-target-not-tenant-owned#read": (p: {
    name: unknown;
    source: unknown;
    aggregate: unknown;
  }) =>
    `policy in context '${p.name}': \`${p.source}\` targets '${p.aggregate}', which ` +
    `is not \`with tenantOwned\`.  A read level refines the tenant floor, so it applies only ` +
    `to tenant-owned aggregates (crossTenant / unscoped / the registry have no tenant scope).`,
  "loom.policy-target-not-tenant-owned#write": (p: {
    name: unknown;
    source: unknown;
    aggregate: unknown;
  }) =>
    `policy in context '${p.name}': \`${p.source}\` targets '${p.aggregate}', which ` +
    `is not \`with tenantOwned\`.  A write level refines the tenant floor, so it applies only ` +
    `to tenant-owned aggregates.`,
  // Hierarchical data visibility is gone (D-TENANCY-FLAT): a row is visible to
  // its own org only, and reach beyond it is an explicit share or row rule.
  "loom.policy-level-removed": (p: { source: unknown; level: unknown }) =>
    `\`${p.source}\`: the '${p.level}' level no longer exists — data visibility is flat, so a ` +
    `tenant-owned row is visible to its own org only ('local', the default).  To reach rows of ` +
    `other orgs, grant them explicitly with a share or a row rule (D-SHARING); drop this rule ` +
    `or write \`allow local on …\`.`,
  "loom.policy-deny-duplicate": (p: {
    name: unknown;
    access: unknown;
    aggregate: unknown;
    source: unknown;
    access2: unknown;
  }) =>
    `policy in context '${p.name}' denies ${p.access} on '${p.aggregate}' more ` +
    `than once (\`${p.source}\`); one \`deny ${p.access2}` +
    `on ${p.aggregate}\` is total — keep exactly one.`,
  "loom.policy-deny-unknown-aggregate": (p: {
    name: unknown;
    source: unknown;
    aggregate: unknown;
  }) =>
    `policy in context '${p.name}': \`${p.source}\` names '${p.aggregate}', which ` +
    `is not an aggregate in this context.  A deny carve-out scopes an aggregate declared ` +
    `in the same context.`,
  "loom.policy-deny-shadows-allow": (p: {
    name: unknown;
    source: unknown;
    access: unknown;
    aggregate: unknown;
  }) =>
    `policy in context '${p.name}': \`${p.source}\` shadows an \`allow\` ${p.access} ` +
    `rule for '${p.aggregate}' — deny wins, so the allow is dead.  Remove the allow, or ` +
    `the deny if you meant to keep the grant.`,
  "loom.auth-dev-login-only": (p: { name: unknown }) =>
    `deployable '${p.name}': auth: required without auth { oidc }: development login only.  ` +
    `The generated verifier is the dev stub: it answers only when LOOM_DEV_AUTH=1 (the generated ` +
    `docker-compose.yml sets it; every request is 401 otherwise), accepts any caller as a built-in ` +
    `identity, and lets the caller forge any role, permission or tenant through the ` +
    `x-loom-dev-claims header; default-deny enforcement is not checked.  Declare an ` +
    `\`auth { oidc { … } }\` block, or replace the stub with your own verifier, before deploying.`,
} satisfies Record<string, MessageEntry>;

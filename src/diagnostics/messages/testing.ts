// The `testing` family of the diagnostic-message catalog: tests, e2e assertions, matchers and requirements.
//
// A code lives in the family that owns its first segment (`loom.<segment>-…`),
// listed in `segments` below; `../messages.ts` merges every family into
// `DIAGNOSTIC_MESSAGES`, and `test/system/diagnostic-catalog.test.ts` fails on a
// key filed under the wrong family.  A code with a brand-new first segment adds
// that segment to the family it belongs with.

import { didYouMean, type MessageEntry } from "./_shared.js";

/** The code first-segments this family owns. */
export const segments = [
  "e2e",
  "test",
  "requirement",
  "expect",
  "matcher",
  "tothrow",
  "locator",
  "unit",
  "not",
  "context",
] as const;

export const messages = {
  // ----------------------------------------------------------------------
  // src/language/validators/seed.ts
  // ----------------------------------------------------------------------
  "loom.locator-matcher-receiver": (p: { matcher: unknown; actual: unknown }) =>
    `'${p.matcher}' asserts against a DOM element, so 'expect(...)' must be given a field ` +
    "read on a row the test has on screen — bind one with `let <row> = " +
    "ui.<aggregate>.getById(...)` or `ui.<aggregate>.create(...)`, then assert " +
    `\`expect(<row>.<field>).${p.matcher}(...)\`. Got \`${p.actual}\`, which resolves to no ` +
    "locator (a plain value, an `id`, or a nested path the page object does not expose); " +
    "compare a plain value with `toBe` instead.",
  // `toThrow` in a UI e2e body.  Two messages, one code: the status form and
  // the bare form fail for overlapping but distinct reasons, and a refusal that
  // does not name the author's own argument reads as a parser quirk.
  //
  // The api body keeps `toThrow(<status>)` — there it is a real response status
  // off a real `fetch`, pinned by `e2e-render.ts`'s `/→ N\b/` matcher.  The ui
  // body has a DOM state instead, which is NOT the same assertion; conflating
  // the two is what produced the dropped argument in the first place.
  "loom.e2e-ui-throw-invalid#status": (p: { status: unknown }) =>
    `'toThrow(${p.status})' pins an HTTP status, but this 'test e2e' block targets a ` +
    "frontend, so it lowers to a Playwright spec driven through the generated page " +
    `objects — there is no HTTP response to read ${p.status} from. The emitted form ` +
    "validates CLIENT-side (a schema derived from the aggregate's own invariants), so an " +
    "invalid submit issues no request at all. Assert the DOM state instead — " +
    "`expect(<row>.<field>).toHaveText(...)` / `.toHaveCount(...)` / `.toBeVisible()` on a " +
    "row the test has on screen — or move the negative case to a block written " +
    `\`against <backend-deployable>\` with \`api.<aggregate>....\`, where \`toThrow(${p.status})\` ` +
    "pins a real response status.",
  "loom.e2e-ui-throw-invalid#bare":
    "'toThrow()' cannot run in a 'test e2e' block that targets a frontend: the generated " +
    "page object's `submit()` awaits the detail page's testid, which an invalid form never " +
    "renders, so the assertion settles only when a Playwright timeout fires — it can never " +
    "pass for the reason it was written. Assert the DOM state instead — " +
    "`expect(<row>.<field>).toHaveText(...)` / `.toHaveCount(...)` / `.toBeVisible()` on a " +
    "row the test has on screen — or move the negative case to a block written " +
    "`against <backend-deployable>` with `api.<aggregate>....`, where `toThrow()` runs " +
    "against a real response.",
  // `toThrow(<kind>)` in a `test e2e` body.  The matcher is TIER-SPLIT and the
  // refusal has to say why, or it reads as an arbitrary restriction: the two
  // rungs are structurally distinct in-process and indistinguishable on the
  // wire, so the same word would be a strong claim in one tier and a weak one
  // in the other.  That is the shape #2959 fixed on the ui side.
  "loom.e2e-throw-kind-invalid": (p: { kind: unknown }) =>
    `'toThrow(${p.kind})' pins WHICH domain rung rejected the call, and that is only ` +
    "observable IN-PROCESS: the generated domain layer raises a typed error carrying the " +
    "rung as a structural `kind` field, whatever the rule's message says. Over HTTP both " +
    "rungs answer 422, and their only discriminator is the RFC 7807 `detail` sentence — " +
    "which the rule's own text overwrites. Pin the wire fact here " +
    "instead — `toThrow(<status>)`, e.g. `toThrow(422)` — and move the rung assertion to " +
    `a unit \`test\` block on the aggregate, where \`toThrow(${p.kind})\` reads the real ` +
    "domain error.",
  // `toBeAbsent()` in a unit `test` body.  Absence-vs-null is a statement about
  // a SERIALIZED PAYLOAD, and the unit tier has none: the subject is an
  // aggregate struct where a declared field always exists.  Three of the five
  // backends could not observe "absent" in-process even in principle (C#
  // `int?`, Java `Integer`, an Elixir struct's `nil` default), so the matcher
  // would either degrade to a null check — a silent synonym for `toBeNull`,
  // one name meaning two strengths of claim, the #2959 defect — or emit an
  // assertion that can never pass.  Name the tier and the alternative.
  // `toBeNull()` / `toBeAbsent()` in a `test e2e` body that lowers to the
  // PLAYWRIGHT renderer.  Third tier, third reason, and the same shape F7 found
  // for `toThrow`: a ui body asserts against RENDERED TEXT, and
  // `ui-e2e-render.ts` lowers a value matcher onto
  // `(await <handle>.field("x").innerText())` \u2014 always a string.  So
  // `toBeNull()` there is an assertion that can never pass, and `toBeAbsent()`
  // is not a runtime matcher at all: the emitted spec would TypeError.  Neither
  // absence spelling is observable through rendered text \u2014 a field the page
  // did not render has no locator to read, which is a `toBeVisible` question.
  "loom.e2e-ui-absence-invalid": (p: { matcher: unknown }) =>
    `'${p.matcher}()' asserts an ABSENCE in a payload, and a ui \`test e2e\` body has no ` +
    "payload: its assertions read RENDERED TEXT off a Playwright locator, which is always " +
    'a string. Here the matcher would lower onto `(await <row>.field("...").innerText())` ' +
    `\u2014 ${p.matcher === "toBeNull" ? "a comparison that can never hold" : "a matcher the test runtime does not define, so the generated spec would fail to run"}. ` +
    'Assert what the page actually shows instead: `toHaveText("")` for an empty cell, or ' +
    "`toBeVisible()` on the field that should or should not be there. To pin the WIRE " +
    "spelling, move the assertion to a block targeting a BACKEND deployable, where a real " +
    "response body carries one.",
  "loom.unit-absent-invalid": () =>
    "'toBeAbsent()' asserts that a key is MISSING FROM THE PAYLOAD, which only means " +
    "something once a value has been serialized \u2014 so it is valid in a `test e2e` block " +
    "only. A unit `test` asserts against an in-memory aggregate, where a declared field " +
    "always exists (C# `int?`, Java `Integer` and an Elixir struct's `nil` default have no " +
    "absent form at all). Use `toBeNull()` here \u2014 Loom has ONE absence value, and in-process " +
    "that is the whole of it. To pin the WIRE spelling, move the assertion to a `test e2e` " +
    "block, where `toBeAbsent()` and `toBeNull()` are two different claims.",

  // ----------------------------------------------------------------------
  // src/language/validators/stmt-placement.ts
  // ----------------------------------------------------------------------
  "loom.not-found-placement": (p: { owner: unknown }) =>
    `'notFound' answers the request with the not-found ProblemDetails, so only a body that handles a request may say it: a workflow body ('create' / 'on') or a top-level 'commandHandler' / 'queryHandler'. This one is in ${p.owner}. An operation or domain function refuses with 'precondition' / 'requires' or a declared 'error' variant instead; do the lookup and the 404 in the handler that calls it.`,
  "loom.not-found-unreachable": () =>
    "This statement follows a 'notFound', which ends the body — it can never run. Move it before the 'notFound', or into the branch that finds the row.",

  // --- the M-T9.56 drain of `match.ts` ------------------------------------
  "loom.matcher-arity": (p: { matcher: unknown; arity: unknown; got: unknown }) =>
    `matcher '${p.matcher}' takes ${p.arity} argument(s), got ${p.got}.`,
  "loom.expect-requires-matcher":
    "'expect' requires a matcher — write 'expect(<actual>).toBe(<expected>)' (or .toThrow(), .toHaveText(…), …), not a bare expression.",
  "loom.matcher-e2e-only#same-instant":
    "'toBeSameInstant' compares wire timestamps and is only valid in a 'test e2e' block; compare in-memory values with 'toBe' in an in-process test.",
  "loom.matcher-e2e-only#throw-status":
    "'toThrow(<status>)' pins an HTTP status and is only valid in a 'test e2e' block; use a bare 'toThrow()' in an in-process test.",
  "loom.tothrow-arity": (p: { got: unknown }) =>
    `'toThrow' takes at most one argument (an HTTP status), got ${p.got}.`,
  "loom.not-throw-invalid":
    "'.not.toThrow()' is not supported — 'toThrow' has no negated form. Call the operation directly; an unexpected throw already fails the test.",
  "loom.tothrow-status-not-int":
    "'toThrow(<status>)' requires an integer HTTP status literal, e.g. toThrow(404).",

  // ----------------------------------------------------------------------
  // src/language/validators/test-placement.ts
  // ----------------------------------------------------------------------
  "loom.test-redundant-for#a-nested-test-already-belongs": (p: { $refText: unknown }) =>
    `A nested 'test' already belongs to its enclosing subject — drop the ` +
    `'for ${p.$refText}' head (name a subject with 'for' only when ` +
    `the test is hoisted out of it).`,
  "loom.test-redundant-for#a-test-nested-in-context": (p: { name: unknown; $refText: unknown }) =>
    `A 'test' nested in context '${p.name}' already targets it — drop the ` +
    `'for ${p.$refText}' head.`,
  "loom.test-needs-target": (p: { name: unknown }) =>
    `A 'test' declared outside its subject must name it: ` +
    `\`test ${p.name} for <Subject> { … }\`.`,
  "loom.test-principal-placement": (p: { name: unknown }) =>
    `Test ${p.name} declares an 'as { … }' principal, but only a context integration ` +
    `'test' (nested in a context, or 'for <Context>') and a 'test e2e' block run as a ` +
    `principal — an aggregate, value-object or domain-service unit test never reaches ` +
    `the auth layer.  Drop the clause, or move the test to its context.`,
  "loom.test-principal-value": (p: { name: unknown }) =>
    `Principal claim '${p.name}' must be a string literal (\`${p.name}: "acme"\`) or a list ` +
    `of string literals (\`${p.name}: ["agent"]\`) — a test principal is fixed data, not an ` +
    `expression.`,
  "loom.test-principal-duplicate-claim": (p: { name: unknown }) =>
    `Principal claim '${p.name}' is set twice in one 'as { … }' clause — keep one.`,
  "loom.context-test-unsupported": (p: { name: unknown }) =>
    `Context integration tests emit on every backend (test-placement.md), but context ` +
    `'${p.name}' is not hosted by any backend deployable, so this 'test' produces no ` +
    `runnable test yet.`,

  // ----------------------------------------------------------------------
  // src/language/validators/traceability.ts  (M-T9.56 drain)
  // ----------------------------------------------------------------------
  // The `requirement { … }` property block: an unknown key, a repeated key,
  // the four per-value shape rules, the two required keys and the parent-chain
  // cycle.  The menus are DERIVED from the same sets the checks test against.
  "loom.requirement-property-unknown": (p: { name: unknown; known: unknown }) =>
    `Unknown requirement property '${p.name}'; expected one of ${p.known}.`,
  "loom.requirement-property-duplicate": (p: { name: unknown }) =>
    `Duplicate requirement property '${p.name}'.`,
  "loom.requirement-type-invalid": (p: { known: unknown }) =>
    `requirement type must be one of ${p.known}.`,
  "loom.requirement-status-invalid": (p: { known: unknown }) =>
    `requirement status must be one of ${p.known}.`,
  "loom.requirement-title-not-string": "requirement title must be a string literal.",
  "loom.requirement-priority-not-int": "requirement priority must be an integer.",
  // One code, two slugs — `type` and `title` are the two required properties,
  // and "you left out a required property" is one rule.
  "loom.requirement-property-missing#type": (p: { name: unknown }) =>
    `requirement '${p.name}' is missing the required 'type' property.`,
  "loom.requirement-property-missing#title": (p: { name: unknown }) =>
    `requirement '${p.name}' is missing the required 'title' property.`,
  "loom.requirement-parent-cycle": (p: { name: unknown }) =>
    `requirement '${p.name}' has a cyclic parent chain.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/ui-framework-checks.ts — the two LiveView
  // component-HOISTING collisions (§18 emitter sentinels).  Both used to be a
  // bare `throw new Error` in `liveview-emit.ts`, raised mid-generate on a
  // `.ddd` that had just validated `0 error(s), 0 warning(s)`.
  // ----------------------------------------------------------------------
  "loom.context-filter-no-principal": (p: {
    name: unknown;
    platform: unknown;
    ctxName: unknown;
    aggName: unknown;
  }) =>
    `Deployable '${p.name}' (platform ${p.platform}) hosts aggregate ` +
    `'${p.ctxName}.${p.aggName}' with a 'filter' capability predicate that references ` +
    `currentUser (e.g. a tenancy filter), but the deployable has no auth — there is no ` +
    `request-scoped principal to scope reads by. Add 'auth: required' (and a system ` +
    `'user {}' block), or remove the principal-referencing filter.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/test-principal-checks.ts
  // ----------------------------------------------------------------------
  "loom.test-principal-no-user": (p: { test: unknown }) =>
    `Test '${p.test}' declares an 'as { … }' principal, but its system declares no ` +
    `'user { … }' block, so there is no claim shape to bind — declare one, or drop the clause.`,
  "loom.test-principal-unknown-claim": (p: { name: unknown; fields: unknown }) =>
    `Principal claim '${p.name}' is not a field of the system's 'user { … }' block ` +
    `(declared: ${p.fields}).`,
  "loom.test-principal-claim-type": (p: { name: unknown; shape: unknown }) =>
    p.shape === "string"
      ? `Principal claim '${p.name}' is a 'string' field — give it one string literal, not a list.`
      : p.shape === "uuid"
        ? `Principal claim '${p.name}' is a 'guid' / id field — give it one UUID string literal ` +
          `("00000000-0000-0000-0000-000000000001").`
        : p.shape === "stringList"
          ? `Principal claim '${p.name}' is a 'string[]' field — give it a list of string ` +
            `literals (\`${p.name}: ["agent"]\`).`
          : `Principal claim '${p.name}' has a type a test principal cannot set — only ` +
            `'string', 'guid', '<Aggregate> id' and 'string[]' claims are settable.`,
  "loom.e2e-principal-claim-not-carried": (p: { name: unknown }) =>
    `A 'test e2e' principal travels in the dev-stub 'x-loom-dev-claims' header, which ` +
    `carries only non-optional 'string' and 'string[]' claims — '${p.name}' would be ` +
    `dropped by the backend and the block would run with its dev-stub value.`,
  "loom.e2e-principal-oidc": (p: { test: unknown }) =>
    `'test e2e' '${p.test}' declares an 'as { … }' principal, but the system declares ` +
    `'auth { oidc }': the running backend verifies bearer tokens and ignores the dev-stub ` +
    `claims header, so the block would run as the token's principal instead.  Run it ` +
    `against a dev-stub system, or drop the clause and pass E2E_BEARER_TOKEN.`,
  "loom.e2e-principal-ui": (p: { test: unknown }) =>
    `'test e2e' '${p.test}' drives a ui (Playwright) and declares an 'as { … }' principal — ` +
    `the browser session signs in once per suite, so a per-block principal is not ` +
    `supported there.  Write the block against the backend's 'api', or drop the clause.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/test-checks.ts
  // ----------------------------------------------------------------------
  "loom.test-statement-invalid": (p: {
    owner: unknown;
    testName: unknown;
    reason: unknown;
    tier: unknown;
    allowed: unknown;
  }) =>
    `${p.owner} test '${p.testName}': ${p.reason} ` +
    `A ${p.tier} test body may only contain ${p.allowed} statements — it has no operation to guard and no aggregate to mutate. ` +
    `Exercise the behaviour through an operation call and assert on the result with 'expect' / 'expect-throws'.`,
  "loom.e2e-unsupported-statement": (p: { name: unknown; badKind: unknown; magicId: unknown }) =>
    `e2e test '${p.name}': '${p.badKind}' is not supported in an e2e test body. ` +
    `Only expect, expect-throws, let, expression, and ${p.magicId}.<...> calls are allowed.`,
  "loom.e2e-unaddressable-call": (p: { magicId: unknown; method: unknown }) =>
    `\`${p.magicId}.${p.method}(…)\` is not a shape the e2e harness can address. Every call it emits is two-level — \`${p.magicId}.<aggregate>.<method>(…)\`, \`${p.magicId}.<projection>.{byKey,list}(…)\`, \`${p.magicId}.<workflow>.{run,instances,instance}(…)\` or, for an explicit \`route … -> <Context>.<Handler>\` binding, \`${p.magicId}.<context>.<handler>(…)\`.`,
  "loom.e2e-unresolved-ref": (p: { testName: unknown; name: unknown }) =>
    `e2e test '${p.testName}': '${p.name}' is not a 'let' binding or a magic receiver ('api'/'ui'). ` +
    `An e2e body drives the deployable over HTTP, so it resolves no domain names — ` +
    `an enum value belongs there as its wire string (e.g. "${p.name}"). ` +
    `Emitting it verbatim would ship an undefined identifier in the generated test.`,
  "loom.e2e-unresolved-call": (p: { testName: unknown; name: unknown }) =>
    `e2e test '${p.testName}': '${p.name}(…)' resolves to no function. ` +
    `An e2e body drives the deployable over HTTP and resolves no domain names; ` +
    `the conversions it may call (money(…), decimal(…), string(…), int(…)) are ` +
    `built in. Emitting it verbatim would ship an undefined identifier in the ` +
    `generated test.`,
  "loom.e2e-unknown-workflow": (p: { magicId: unknown; method: unknown; known: unknown }) =>
    `e2e: unknown workflow '${p.magicId}.workflows.${p.method}' on this deployable. ` +
    `Available workflows: ${p.known}.`,
  "loom.e2e-unknown-method#projection": (p: {
    magicId: unknown;
    aggregateSlug: unknown;
    method: unknown;
  }) =>
    `e2e: unknown projection read '${p.magicId}.${p.aggregateSlug}.${p.method}'. ` +
    `A folded projection exposes: byKey, list.`,
  "loom.e2e-unknown-method#aggregate-verb": (p: {
    magicId: unknown;
    aggregateSlug: unknown;
    method: unknown;
    knownVerbs: unknown;
  }) =>
    `e2e: unknown method '${p.magicId}.${p.aggregateSlug}.${p.method}'. ` +
    `Available: ${p.knownVerbs}.`,
  "loom.e2e-unknown-method#workflow": (p: {
    magicId: unknown;
    aggregateSlug: unknown;
    method: unknown;
    knownVerbs: unknown;
  }) =>
    `e2e: unknown workflow verb '${p.magicId}.${p.aggregateSlug}.${p.method}'. ` +
    `A workflow exposes: ${p.knownVerbs} — 'run(…)' posts the command, ` +
    `'instances()' lists the running instances, and 'instance(key)' reads one by ` +
    `its correlation key.`,
  "loom.e2e-unknown-aggregate": (p: {
    magicId: unknown;
    aggregateSlug: unknown;
    known: unknown;
    knownWorkflows: unknown;
    routed?: unknown;
  }) =>
    `e2e: unknown aggregate '${p.magicId}.${p.aggregateSlug}' on this deployable. ` +
    `Available aggregates: ${p.known}. ` +
    `Workflows (called as '${p.magicId}.<workflow>.run(…)' / '.instances()' / ` +
    `'.instance(key)'): ${p.knownWorkflows}.${p.routed ?? ""}`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/e2e-route-checks.ts
  // ----------------------------------------------------------------------
  "loom.e2e-unrouted-verb#create": (p: { magicId: unknown; slug: unknown; aggregate: unknown }) =>
    `e2e: '${p.magicId}.${p.slug}.create(…)' has no route — '${p.aggregate}' declares no create ` +
    `action, so no backend mounts 'POST /api/${p.slug}' and the generated suite would call a ` +
    `route this same compilation did not emit (405). Add 'with crudish' to '${p.aggregate}', ` +
    `or give it an explicit 'create(...) { … }'.`,
  "loom.e2e-call-options#shape": (p: { slug: unknown; verb: unknown }) =>
    `e2e: 'api.${p.slug}.${p.verb}(id, body, options)' — the optional third argument must be ` +
    `exactly '{ ifMatch: <version> }', which sends the 'If-Match' precondition header. No other ` +
    `key and no fourth argument is read, so anything else would be silently dropped.`,
  "loom.e2e-call-options#workflow-shape": (p: { slug: unknown }) =>
    `e2e: 'api.${p.slug}.run(body, options)' — the optional second argument must be exactly ` +
    `'{ ifMatch: <version> }', which sends the 'If-Match' header. No other key and no third ` +
    `argument is read, so anything else would be silently dropped.`,
  "loom.e2e-call-options#if-match-scope": (p: {
    slug: unknown;
    verb: unknown;
    aggregate: unknown;
  }) =>
    `e2e: 'api.${p.slug}.${p.verb}(…, { ifMatch: … })' — only an operation of a 'versioned' ` +
    `aggregate reads 'If-Match', and '${p.aggregate}.${p.verb}' is not one (an event-sourced ` +
    `aggregate is checked against its stream version, never the header). Drop the third argument.`,
  "loom.e2e-unrouted-verb#destroy": (p: { slug: unknown; aggregate: unknown }) =>
    `e2e: 'api.${p.slug}.destroy(…)' has no route — '${p.aggregate}' declares no canonical ` +
    `'destroy { }', so no backend mounts 'DELETE /api/${p.slug}/{id}'. Add 'with crudish' to ` +
    `'${p.aggregate}', or give it an unnamed 'destroy { … }' (a NAMED destroy is a domain ` +
    `command and gets no DELETE route).`,
  "loom.e2e-unrouted-verb#history": (p: { slug: unknown; aggregate: unknown }) =>
    `e2e: 'api.${p.slug}.history(…)' has no route — '${p.aggregate}' is not audited, so no ` +
    `backend mounts 'GET /api/${p.slug}/{id}/history'. Add 'with auditable' to '${p.aggregate}'.`,
  "loom.e2e-unrouted-verb#find": (p: { slug: unknown; verb: unknown; aggregate: unknown }) =>
    `e2e: 'api.${p.slug}.${p.verb}(…)' has no route — the find '${p.verb}' on '${p.aggregate}' is ` +
    `compiler-synthesized (an internal retrieval materialised behind a criterion read), and the ` +
    `api surface mounts only DECLARED finds. Declare 'find ${p.verb}(...)' on the repository to ` +
    `give it a 'GET /api/${p.slug}/${p.verb}' route.`,
  "loom.e2e-unrouted-verb#verb": (p: {
    slug: unknown;
    verb: unknown;
    aggregate: unknown;
    routed: unknown;
  }) =>
    `e2e: 'api.${p.slug}.${p.verb}(…)' resolves to no route this model emits for ` +
    `'${p.aggregate}'. Routed verbs: ${p.routed}.`,
  "loom.e2e-unrouted-verb#workflow-run": (p: { slug: unknown; workflow: unknown }) =>
    `e2e: 'api.${p.slug}.run(…)' has no route — workflow '${p.workflow}' is started by an ` +
    `EVENT, not by a command, so no backend mounts 'POST /api/workflows/${p.slug}'. It is a ` +
    `reactor the in-process dispatcher starts: drive the operation that emits its trigger ` +
    `event instead, then read the saga back with 'api.${p.slug}.instances()' / ` +
    `'.instance(key)'.`,
  "loom.e2e-unrouted-verb#workflow-instance": (p: {
    slug: unknown;
    verb: unknown;
    workflow: unknown;
  }) =>
    `e2e: 'api.${p.slug}.${p.verb}(…)' has no route — workflow '${p.workflow}' declares no ` +
    `correlation field, so it persists no instance row and no backend mounts ` +
    `'GET /api/workflows/${p.slug}/instances'. Declare one id-shaped state field ` +
    `(e.g. 'orderId: Order id') to give it an instance to read.`,
  "loom.e2e-routed-handler-arity": (p: {
    slug: unknown;
    verb: unknown;
    expected: unknown;
    got: unknown;
    params: unknown;
    method: unknown;
    path: unknown;
  }) =>
    `e2e: 'api.${p.slug}.${p.verb}(…)' takes ${p.expected} argument(s) (${p.params}), got ` +
    `${p.got}. A routed handler's arguments are POSITIONAL, in declared param order — ` +
    `'route ${p.method} "${p.path}"' binds a param by NAME to the matching {token} and sends ` +
    `the rest as the query string (GET / DELETE) or the request body.`,
  "loom.e2e-unrouted-verb#ui-verb": (p: { slug: unknown; verb: unknown; known: unknown }) =>
    `ui e2e: 'ui.${p.slug}.${p.verb}(…)' drives no page object — the Playwright harness ` +
    `addresses the New-page create flow, the Detail-page read, and a public operation's ` +
    `detail-page action. Addressable: ${p.known}.`,
  // The PAYLOAD half of the same file.  An e2e body speaks WIRE: it sends JSON
  // and reads JSON back, so every one of these judges the request/response
  // shape the renderer will emit, never the domain spelling.
  "loom.e2e-unknown-body-key#create": (p: {
    slug: unknown;
    key: unknown;
    aggregate: unknown;
    known: unknown;
    suggestion?: unknown;
  }) =>
    `e2e: 'api.${p.slug}.create(…)' sends '${p.key}', which is not a create field of ` +
    `'${p.aggregate}'.${didYouMean(p.suggestion)} The create body is the aggregate's create-input projection and the ` +
    `backend rejects an unknown key (422), so the call fails for the typo rather than for ` +
    `whatever the test claims to prove. Accepted keys: ${p.known}.`,
  "loom.e2e-unknown-body-key#operation": (p: {
    slug: unknown;
    verb: unknown;
    key: unknown;
    known: unknown;
    suggestion?: unknown;
  }) =>
    `e2e: 'api.${p.slug}.${p.verb}(id, {…})' sends '${p.key}', which is not a parameter of ` +
    `'${p.verb}'.${didYouMean(p.suggestion)} The operation body carries exactly the declared parameters and the backend ` +
    `rejects an unknown key (422), so the call fails for the typo rather than for whatever the ` +
    `test claims to prove. Accepted keys: ${p.known}.`,
  "loom.e2e-unknown-body-key#workflow-run": (p: {
    slug: unknown;
    key: unknown;
    workflow: unknown;
    known: unknown;
    suggestion?: unknown;
  }) =>
    `e2e: 'api.${p.slug}.run({…})' sends '${p.key}', which is not a parameter of workflow ` +
    `'${p.workflow}'.${didYouMean(p.suggestion)} Unlike an aggregate body this one is NOT rejected: the emitted ` +
    `'${p.workflow}Request' is a plain object schema on every backend, so an unknown key is ` +
    `DROPPED and the POST still answers 204 — the workflow never receives it, and an assertion ` +
    `resting on it passes while proving nothing. Accepted keys: ${p.known}.`,
  "loom.e2e-missing-required-field#workflow-run": (p: {
    slug: unknown;
    workflow: unknown;
    missing: unknown;
    known: unknown;
  }) =>
    `e2e: 'api.${p.slug}.run({…})' omits ${p.missing} — a required parameter of workflow ` +
    `'${p.workflow}'. The command body carries exactly the starter's declared parameters, and ` +
    `only an optional one ('p: T?') may be left out: a parameter with an '= default' is still ` +
    `required on the wire, because the default is applied in the BODY, not by the request ` +
    `schema. The backend answers 422 without it. Required keys: ${p.known}.`,
  "loom.e2e-missing-required-field": (p: {
    slug: unknown;
    aggregate: unknown;
    missing: unknown;
    known: unknown;
  }) =>
    `e2e: 'api.${p.slug}.create(…)' omits ${p.missing} — required create input on ` +
    `'${p.aggregate}'. A field is omittable only when it is optional ('f: T?'), carries an ` +
    `'= default', or is a bare 'bool'; anything else the client must supply, and the backend ` +
    `answers 422 without it. Required keys: ${p.known}.`,
  "loom.e2e-unknown-response-field#workflow-instance": (p: {
    read: unknown;
    slug: unknown;
    workflow: unknown;
    known: unknown;
    suggestion?: unknown;
  }) =>
    `e2e: '${p.read}' reads a field the response does not carry.${didYouMean(p.suggestion)} ` +
    `The body of 'api.${p.slug}.instance(…)' is the persisted instance shape of workflow ` +
    `'${p.workflow}': its correlation field, then its state fields. The read is 'undefined' at ` +
    `run time, so an assertion over it passes or fails for the wrong reason. Readable: ${p.known}.`,
  "loom.e2e-unknown-response-field#projection": (p: {
    read: unknown;
    slug: unknown;
    projection: unknown;
    known: unknown;
    suggestion?: unknown;
  }) =>
    `e2e: '${p.read}' reads a field the response does not carry.${didYouMean(p.suggestion)} ` +
    `The body of 'api.${p.slug}.byKey(…)' is one row of projection '${p.projection}': its key, ` +
    `then its state fields. The read is 'undefined' at run time, so an assertion over it passes ` +
    `or fails for the wrong reason. Readable: ${p.known}.`,
  "loom.e2e-unknown-query-key": (p: {
    slug: unknown;
    key: unknown;
    aggregate: unknown;
    known: unknown;
    suggestion?: unknown;
  }) =>
    `e2e: 'api.${p.slug}.all({ ${p.key}: … })' sends the query key '${p.key}', which the ` +
    `'${p.aggregate}' list route does not read.${didYouMean(p.suggestion)} The route ignores ` +
    `it and answers the default page, so an assertion about the page the test asked for passes ` +
    `or fails for the wrong reason. Accepted keys: ${p.known}.`,
  "loom.e2e-projection-read-arity": (p: {
    slug: unknown;
    verb: unknown;
    projection: unknown;
    got: unknown;
    expected: unknown;
  }) =>
    `e2e: 'api.${p.slug}.${p.verb}(…)' passes ${p.got} argument(s), but projection ` +
    `'${p.projection}''s '${p.verb}' read takes ${p.expected}: 'byKey(key)' reads one row by its ` +
    `key and 'list(…)' passes the projection's declared parameters, in declared order, as the ` +
    `query string. Pass exactly ` +
    `${p.expected}.`,
  "loom.e2e-body-type-mismatch": (p: {
    slug: unknown;
    verb: unknown;
    key: unknown;
    declared: unknown;
    got: unknown;
  }) =>
    `e2e: 'api.${p.slug}.${p.verb}(…)' sends ${p.got} for '${p.key}', declared '${p.declared}'. ` +
    `An e2e body carries WIRE values, so the literal has to be the JSON form of the declared ` +
    `type — the backend's request schema rejects anything else (422).`,
  "loom.e2e-body-type-mismatch#money": (p: {
    slug: unknown;
    verb: unknown;
    key: unknown;
    got: unknown;
    digits: unknown;
  }) =>
    `e2e: 'api.${p.slug}.${p.verb}(…)' sends ${p.got} for '${p.key}', declared 'money'. ` +
    `A money crosses the wire as its fixed-scale STRING and no backend accepts a JSON number ` +
    `for it — write "${p.digits}" or money("${p.digits}").`,
  "loom.e2e-body-type-mismatch#enum": (p: {
    slug: unknown;
    verb: unknown;
    key: unknown;
    declared: unknown;
    got: unknown;
    members: unknown;
  }) =>
    `e2e: 'api.${p.slug}.${p.verb}(…)' sends ${p.got} for '${p.key}', declared '${p.declared}'. ` +
    `An enum crosses the wire as the member name spelled EXACTLY, as a string. ` +
    `Members of '${p.declared}': ${p.members}.`,
  "loom.e2e-unknown-response-field": (p: {
    read: unknown;
    slug: unknown;
    verb: unknown;
    aggregate: unknown;
    known: unknown;
    suggestion?: unknown;
  }) =>
    `e2e: '${p.read}' reads a field the response does not carry.${didYouMean(p.suggestion)} ` +
    `The body of 'api.${p.slug}.${p.verb}(…)' is the api-read wire shape of '${p.aggregate}'. ` +
    `The read is 'undefined' at run time, so an assertion over it passes or fails for the wrong ` +
    `reason. Readable: ${p.known}.`,
  "loom.e2e-unknown-response-field#create": (p: {
    read: unknown;
    handle: unknown;
    field: unknown;
    slug: unknown;
    aggregate: unknown;
  }) =>
    `e2e: '${p.read}' reads a field the response does not carry — the body of ` +
    `'api.${p.slug}.create(…)' is the id envelope '{ id }' on every backend, not the ` +
    `'${p.aggregate}' row. The read is 'undefined' at run time, so an assertion over it passes ` +
    `or fails for the wrong reason. Read the row back instead — ` +
    `'api.${p.slug}.getById(${p.handle})', then '.${p.field}' on that — or read only ` +
    `'${p.handle}.id'.`,
} satisfies Record<string, MessageEntry>;

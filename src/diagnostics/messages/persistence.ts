// The `persistence` family of the diagnostic-message catalog: repositories, reads, criteria, retrievals, unique keys and table naming.
//
// A code lives in the family that owns its first segment (`loom.<segment>-…`),
// listed in `segments` below; `../messages.ts` merges every family into
// `DIAGNOSTIC_MESSAGES`, and `test/system/diagnostic-catalog.test.ts` fails on a
// key filed under the wrong family.  A code with a brand-new first segment adds
// that segment to the family it belongs with.

import { didYouMean, type MessageEntry } from "./_shared.js";

/** The code first-segments this family owns. */
export const segments = [
  "repo",
  "repository",
  "find",
  "findall",
  "retrieval",
  "criterion",
  "filter",
  "unique",
  "index",
  "saving",
  "persisted",
] as const;

export const messages = {
  // ----------------------------------------------------------------------
  // src/language/validators/repo-verbs.ts
  // ----------------------------------------------------------------------
  "loom.repo-verb-renamed": (p: {
    receiver: unknown;
    verb: unknown;
    next: unknown;
    hint: unknown;
  }) =>
    `'${p.receiver}.${p.verb}(…)' is no longer a repository verb — it is '${p.receiver}.${p.next}(…)'.` +
    `${p.hint} The repository reads are get(id) / find(id) / find(<Criterion>) / ` +
    `getBy(…) / findBy(…) / all(…), and the write is remove(x). ` +
    "`node scripts/codemod-repo-verbs.mjs` migrates a whole tree.",
  "loom.repo-get-criterion": (p: { receiver: unknown; ref: unknown }) =>
    `'${p.receiver}.get(${p.ref})': 'get' loads one row by its id, and '${p.ref}' is a criterion. ` +
    `Read the first match with '${p.receiver}.find(${p.ref})', or every match with ` +
    `'${p.receiver}.all(${p.ref})'.`,
  "loom.repo-get-criterion#retrieval": (p: { receiver: unknown; ref: unknown }) =>
    `'${p.receiver}.get(${p.ref})': 'get' loads one row by its id, and '${p.ref}' is a retrieval, ` +
    `which selects a list. Run it with '${p.receiver}.all(${p.ref})'.`,
  "loom.repo-find-retrieval": (p: { receiver: unknown; ref: unknown }) =>
    `'${p.receiver}.find(${p.ref})': '${p.ref}' is a retrieval, which selects a list of rows — run it ` +
    `with '${p.receiver}.all(${p.ref})'. 'find' takes an id or a criterion.`,
  "loom.repo-all-arg": (p: { receiver: unknown }) =>
    `'${p.receiver}.all(…)' takes a criterion or a retrieval reference ('Active', 'InRegion(r)'), ` +
    "or nothing for the whole collection — not an inline predicate. Declare the predicate as a " +
    "'criterion' and pass its name.",
  "loom.repo-sort-placement": (p: { receiver: unknown; verb: unknown }) =>
    `'sort:' on '${p.receiver ? `${p.receiver}.` : ""}${p.verb}(…)' is never read: it belongs to a ` +
    "repository read over a criterion — 'Repo.all(<Criterion>, sort: [field desc])'.",
  "loom.repo-sort-placement#retrieval": (p: { receiver: unknown; ref: unknown }) =>
    `'${p.receiver}.all(${p.ref}, sort: …)': '${p.ref}' is a retrieval, which declares its own ` +
    "'sort:'. Change the order on the retrieval, or pass a criterion.",

  // ----------------------------------------------------------------------
  // src/language/validators/repo-key-lookup.ts
  // ----------------------------------------------------------------------
  "loom.repo-key-not-unique": (p: {
    repo: unknown;
    verb: unknown;
    cols: unknown;
    agg: unknown;
    declared: unknown;
    suggestion: unknown;
  }) =>
    `'${p.repo}.${p.verb}(${p.cols})': (${p.cols}) is not a declared unique key of '${p.agg}'. ` +
    (p.declared
      ? `Its unique keys are ${p.declared}.${p.suggestion ? ` Did you mean '${p.repo}.${p.verb}(${p.suggestion})'?` : ""} `
      : `'${p.agg}' declares no 'unique (…)' key. `) +
    `'${p.verb}' reads ONE row by a natural key, so its named arguments must equal a ` +
    `'unique (…)' tuple — otherwise two rows can share the key and the read returns whichever ` +
    `the database yields first. Declare 'unique (${p.cols})' on '${p.agg}', or read a list with ` +
    `'${p.repo}.all(<Criterion>)'.`,
  "loom.repo-key-incomplete": (p: {
    repo: unknown;
    verb: unknown;
    agg: unknown;
    tuple: unknown;
    missing: unknown;
  }) =>
    `'${p.repo}.${p.verb}' names part of the unique key (${p.tuple}) of '${p.agg}' but not ` +
    `${p.missing}. Every column of the tuple is required: a partial key can match many rows.`,
  "loom.repo-key-incomplete#positional": (p: { repo: unknown; verb: unknown; agg: unknown }) =>
    `'${p.repo}.${p.verb}' takes NAMED arguments, one per column of a declared unique key of ` +
    `'${p.agg}' ('${p.repo}.${p.verb}(sku: s)'); a positional argument names no column.`,

  // ----------------------------------------------------------------------
  // src/language/validators/criterion.ts
  // ----------------------------------------------------------------------
  "loom.criterion-alias-collision": (p: { name: unknown; alias: unknown }) =>
    `criterion '${p.name}' binds the candidate alias '${p.alias}', but a parameter of the same name already exists — rename one so a bare '${p.alias}' is unambiguous.`,
  "loom.criterion-unsupported-target": (p: { name: unknown }) =>
    `criterion '${p.name}' has an unsupported candidate type. v1 supports 'of <Aggregate>' (a predicate over that aggregate) or 'of bool' (a pure ambient predicate); predicates over primitives / value objects / enums are reserved for the forthcoming 'from <Criterion>(args)' parameter-binding surface.`,
  "loom.criterion-impure#member-call": (p: { name: unknown; member: unknown }) =>
    `criterion '${p.name}' is impure: it calls the operation '${p.member}'. Criteria are pure predicates — call a 'function' (pure) instead of an 'operation' (mutating).`,
  "loom.criterion-impure#free-call": (p: { name: unknown; headName: unknown }) =>
    `criterion '${p.name}' is impure: it calls the operation '${p.headName}'. Criteria are pure predicates — call a 'function' (pure) instead of an 'operation' (mutating).`,
  "loom.criterion-cycle": (p: { name: unknown }) =>
    `criterion '${p.name}' is part of a reference cycle. A criterion may not (transitively) reference itself.`,
  "loom.criterion-retrieval-name-clash": (p: { name: unknown; context: unknown }) =>
    `retrieval '${p.name}' has the same name as a criterion in context '${p.context}'. ` +
    `A criterion and a retrieval may not share a name — rename one (e.g. the retrieval ` +
    `to '${p.name}Sorted').`,
  "loom.criterion-arity": (p: {
    argc: unknown;
    name: unknown;
    want: unknown;
    want2: unknown;
    got: unknown;
    got2: unknown;
  }) =>
    p.argc
      ? `criterion '${p.name}' expects ${p.want} argument${p.want2}; reference it as '${p.name}(…)'.`
      : `criterion '${p.name}' expects ${p.want} argument${p.want2}, but ${p.got} ${p.got2} supplied.`,
  "loom.criterion-target-mismatch": (p: {
    name: unknown;
    critCandidateName: unknown;
    hostName: unknown;
  }) =>
    `criterion '${p.name}' is over '${p.critCandidateName}', but it is used here against '${p.hostName}'. A criterion can only filter the aggregate it is declared 'of'.`,

  // ----------------------------------------------------------------------
  // src/language/validators/structural.ts
  // ----------------------------------------------------------------------
  // --- the M-T9.56 drain of `structural.ts` -------------------------------
  "loom.unique-on-event-sourced": (p: { how: unknown; name: unknown }) =>
    `\`unique (...)\` on ${p.how} aggregate '${p.name}' is not supported — uniqueness is enforced by a DB unique index, which needs a single relational table to constrain.`,
  "loom.unique-duplicate-column": (p: { name: unknown; col: unknown }) =>
    `\`unique\` on aggregate '${p.name}' lists column '${p.col}' twice.`,
  "loom.unique-unknown-field": (p: { name: unknown; col: unknown; known: unknown }) =>
    `\`unique\` on aggregate '${p.name}' references unknown field '${p.col}'. Known fields: ${p.known}.`,
  "loom.unique-collection-field": (p: { col: unknown; name: unknown }) =>
    `\`unique\` column '${p.col}' on aggregate '${p.name}' is a collection; a uniqueness key must list single-valued fields.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/structural-checks.ts
  // ----------------------------------------------------------------------
  "loom.unique-valueobject-field": (p: { col: unknown; name: unknown }) =>
    `\`unique\` column '${p.col}' on aggregate '${p.name}' is a value object, which ` +
    `stores as several columns — a uniqueness key must list single-column ` +
    `(scalar / enum / id) fields.`,
  "loom.unique-tpc-not-hierarchy-wide": (p: {
    name: unknown;
    columns: unknown;
    concretes: unknown;
  }) =>
    `\`unique (${p.columns})\` on abstract aggregate '${p.name}' (inheritanceUsing: ownTable) is ` +
    `enforced per concrete table (${p.concretes}) — each subtype rejects its own duplicates, but ` +
    `the same value can still exist once in EACH sibling table.  If the key must be unique ` +
    `across the whole hierarchy, map it to one shared table: \`inheritanceUsing: sharedTable\`.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/repo-access-checks.ts
  // ----------------------------------------------------------------------
  "loom.repository-access-outside-workflow": (p: { where: unknown; repoName: unknown }) =>
    `${p.where} names repository '${p.repoName}', but a domain member body has no repository in scope — only a workflow (or a command/query handler, or a 'domainService' reading its own context) can load another aggregate. Every backend renders the unresolved name verbatim into a class that never binds it, so the generated project does not compile (node TS2304, .NET CS0103, Java "cannot find symbol", Python NameError, Phoenix an unbound variable). Move the read into a workflow — 'let x = ${p.repoName}.get(…)' — and pass the value this member needs in as a parameter.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/index-suggestion-checks.ts
  // ----------------------------------------------------------------------
  "loom.index-suggestion": (p: { name: unknown; fName: unknown; where: unknown }) =>
    `'${p.name}.${p.fName}' is read on a query filter but has no index. ` + `Consider ${p.where}.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/query-checks.ts
  // ----------------------------------------------------------------------
  "loom.find-where-not-queryable": (p: { name: unknown; findName: unknown; offending: unknown }) =>
    `repository '${p.name}' find '${p.findName}': ` +
    `where-clause is not queryable (${p.offending}). ` +
    `Allowed: comparisons, &&/||/!, parens, ` +
    `'this.<column>' / 'this.<vo>.<sub>' refs, parameter refs, literals.`,
  "loom.find-where-unknown-field": (p: {
    name: unknown;
    findName: unknown;
    unknown: unknown;
    aggName: unknown;
    suggestion?: unknown;
  }) =>
    `repository '${p.name}' find '${p.findName}': ` +
    `where-clause references unknown field ${p.unknown} on aggregate '${p.aggName}'.` +
    didYouMean(p.suggestion),
  "loom.find-where-column-column": (p: { name: unknown; findName: unknown; bothCols: unknown }) =>
    `repository '${p.name}' find '${p.findName}': ` +
    `comparison between two columns (${p.bothCols}) is not queryable. ` +
    `Drizzle's eq()/ne()/lt()/etc. require one column and one value (parameter, literal, or enum value).`,
  "loom.criterion-not-selectable#not-selectable": (p: { name: unknown; offending: unknown }) =>
    `aggregate '${p.name}': a 'filter' capability predicate is not selectable (${p.offending}). ` +
    `Capability filters install at the query layer, so they must lower to the queryable subset: ` +
    `comparisons, &&/||/!, parens, 'this.<column>' / 'this.<vo>.<sub>' refs, 'currentUser.<field>', literals.`,
  "loom.criterion-not-selectable#unknown-field": (p: {
    name: unknown;
    unknown: unknown;
    suggestion?: unknown;
  }) =>
    `aggregate '${p.name}': a 'filter' capability predicate references unknown field ${p.unknown} on '${p.name}'.` +
    didYouMean(p.suggestion),
  "loom.retrieval-where-not-queryable": (p: { name: unknown; offending: unknown }) =>
    `retrieval '${p.name}': where-clause is not queryable (${p.offending}). ` +
    `Allowed: comparisons, &&/||/!, parens, 'this.<column>' / 'this.<vo>.<sub>' refs, parameter refs, literals.`,
  "loom.retrieval-where-unknown-field": (p: {
    name: unknown;
    unknown: unknown;
    aggName: unknown;
    suggestion?: unknown;
  }) =>
    `retrieval '${p.name}': where-clause references unknown field ${p.unknown} on aggregate '${p.aggName}'.` +
    didYouMean(p.suggestion),
  "loom.retrieval-where-column-column": (p: { name: unknown; bothCols: unknown }) =>
    `retrieval '${p.name}': comparison between two columns (${p.bothCols}) is not queryable. ` +
    `eq()/ne()/lt()/etc. require one column and one value (parameter, literal, or enum value).`,
  "loom.retrieval-sort-unknown-field": (p: {
    name: unknown;
    headName: unknown;
    aggName: unknown;
    suggestion?: unknown;
  }) =>
    `retrieval '${p.name}': sort references unknown field '${p.headName}' on aggregate '${p.aggName}'.` +
    didYouMean(p.suggestion),
  "loom.retrieval-loads-unsupported": (p: { name: unknown }) =>
    `retrieval '${p.name}': explicit 'loads:' is not supported yet — ` +
    `retrievals load the whole aggregate. (Per-operation autoload is planned.)`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/ui-framework-checks.ts — the two LiveView
  // component-HOISTING collisions (§18 emitter sentinels).  Both used to be a
  // bare `throw new Error` in `liveview-emit.ts`, raised mid-generate on a
  // `.ddd` that had just validated `0 error(s), 0 warning(s)`.
  // ----------------------------------------------------------------------
  "loom.saving-shape-unsupported": (p: {
    name: unknown;
    platform: unknown;
    ctxName: unknown;
    aggName: unknown;
    shape: unknown;
    supported: unknown;
  }) =>
    `Deployable '${p.name}' (platform ${p.platform}) hosts aggregate ` +
    `'${p.ctxName}.${p.aggName}' with shape(${p.shape}), but that backend can only ` +
    `emit: ${p.supported}.  Use a supported shape, or host this ` +
    `aggregate on a deployable whose platform emits shape(${p.shape}).`,
  // (the old `loom.context-filter-unsupported`'s `#unsupported-predicate` slug
  //  lived here — the "this backend cannot emit that filter" refusal.  There is no such message:
  //  every backend family wires capability filters on every saving shape, and a
  //  message with no reachable call site is an orphan the catalogue gate
  //  rejects — one that documents a limitation the code does not have.  A
  //  future unwired (family, shape) pair adds its own, naming itself.)
  "loom.filter-bypass-unknown-capability": (p: {
    site: unknown;
    ctxName: unknown;
    aggName: unknown;
    cap: unknown;
  }) =>
    `${p.site} on aggregate '${p.ctxName}.${p.aggName}' ignores ` +
    `capability '${p.cap}', but that aggregate does not implement '${p.cap}'. Implement it ` +
    `(with ${p.cap} / implements ${p.cap}) or correct the capability name in the 'ignoring' clause.`,
  "loom.filter-bypass-no-filter": (p: {
    site: unknown;
    ctxName: unknown;
    aggName: unknown;
    cap: unknown;
  }) =>
    `${p.site} on aggregate '${p.ctxName}.${p.aggName}' ignores ` +
    `capability '${p.cap}', but '${p.cap}' contributes no query-filter to bypass (it is a ` +
    `stamps-only / fields-only capability). Remove '${p.cap}' from the 'ignoring' clause.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/tenancy-checks.ts
  // ----------------------------------------------------------------------
  "loom.unique-missing-tenant-scope": (p: { source: unknown; name: unknown; columns: unknown }) =>
    `\`${p.source}\` on tenant-owned aggregate '${p.name}' omits the tenant ` +
    `discriminator — this is a GLOBAL unique across all tenants. Did you mean ` +
    `\`unique (tenantId, ${p.columns})\`?`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/workflow-checks.ts
  // ----------------------------------------------------------------------
  "loom.persisted-table-collision": (p: {
    ctx: unknown;
    first: unknown;
    second: unknown;
    table: unknown;
  }) =>
    `context '${p.ctx}': ${p.first} and ${p.second} both persist to table '${p.table}' — ` +
    `table names are derived from declared names (snake case, pluralised), so the migration ` +
    `would create '${p.table}' twice and every backend would bind two models to one relation. ` +
    `Rename one of them.`,
  "loom.repo-unknown-read": (p: { repoName: unknown; method: unknown; suggestion?: unknown }) =>
    `repository '${p.repoName}' has no method '${p.method}'.${didYouMean(p.suggestion)}  A repository declares no reads of its own: read with get / find(id), getBy / findBy over a declared \`unique (…)\` key, or find / all over a criterion or retrieval.`,
  "loom.findall-criterion-mismatch": (p: {
    name: unknown;
    critName: unknown;
    candidate: unknown;
    repoName: unknown;
    aggName: unknown;
  }) =>
    `workflow '${p.name}': criterion '${p.critName}' is over '${p.candidate}', but the criterion query on '${p.repoName}' queries '${p.aggName}'.  It needs a criterion 'of ${p.aggName}'.`,
  "loom.findall-criterion-arity": (p: {
    name: unknown;
    critName: unknown;
    length: unknown;
    repoName: unknown;
    retrievalArgsLength: unknown;
  }) =>
    `workflow '${p.name}': criterion '${p.critName}' takes ${p.length} argument(s), but the criterion query on '${p.repoName}' passed ${p.retrievalArgsLength}.`,
  "loom.findall-no-page": (p: { name: unknown; critName: unknown; repoName: unknown }) =>
    `workflow '${p.name}': criterion query '${p.critName}' on '${p.repoName}' reads the full result set — an unbounded list read.  Supply 'page: { offset: 0, limit: N }' to bound it.`,
  "loom.repo-all-arg#integration-test": (p: { receiver: unknown }) =>
    `'${p.receiver}.all(…)' in a context 'test' reads the whole collection through the ` +
    `generated repository, which takes no criterion, retrieval, 'sort:' or 'page:' there. ` +
    `Write '${p.receiver}.all()' and assert over the list, or exercise the filtered read ` +
    `through the query handler that runs it.`,
  "loom.repository-unknown": (p: {
    receiver: unknown;
    verb: unknown;
    ctx: unknown;
    agg: unknown;
    declared: unknown;
  }) =>
    `'${p.receiver}.${p.verb}(…)' reads a repository, but no repository named '${p.receiver}' is ` +
    `declared in context '${p.ctx}'.${p.declared}  Declare it — \`repository ${p.receiver} for ` +
    `${p.agg} { }\` — or read through a repository the context declares.`,
  "loom.repository-unknown#aggregate": (p: { receiver: unknown; verb: unknown; repo: unknown }) =>
    `'${p.receiver}.${p.verb}(…)' reads through the aggregate's name, but '${p.receiver}' is an ` +
    `aggregate, not a repository; outside a context 'test' a body reads through the repository: ` +
    `\`${p.repo}.${p.verb}(…)\`.`,
  "loom.repository-unknown#aggregate-no-repository": (p: {
    receiver: unknown;
    verb: unknown;
    repo: unknown;
  }) =>
    `'${p.receiver}.${p.verb}(…)' reads through the aggregate's name, but '${p.receiver}' is an ` +
    `aggregate, not a repository, and the context declares no repository for it.  Declare one — ` +
    `\`repository ${p.repo} for ${p.receiver} { }\` — and read through it: ` +
    `\`${p.repo}.${p.verb}(…)\`.`,
} satisfies Record<string, MessageEntry>;

// The declared repository contract (D-REPOSITORY-CONTRACT).
//
// One pure data table names every built-in repository verb, the canonical
// operation it performs, the argument it takes, the shape of its result and
// whether it reads or writes.  Typing (`language/typing/elaborate.ts`), the IR
// result type (`ir/lower/repo-read.ts`), lowering, the IR validators and the
// emitters all consult this table instead of comparing surface spellings.  The
// IR carries the canonical `op` on every repository statement and read, so an
// emitter dispatches on what a call DOES (`load`, `select-many`, …), never on
// how the `.ddd` source spelled it.  Renaming a surface verb is therefore an
// edit to this table plus typing/lowering — no emitter changes.
//
// It lives in `util/` because both `language/` (typing) and `ir/` (lowering,
// validation) consume it, and the pipeline layering forbids either importing
// the other upward.
//
// A repository declares no reads of its own, so a name that is not a contract
// verb is either unknown (op `unknown-read`, refused) or one of the
// persistence names the contract does not offer (`save`, `insert`, …), which
// classify as writes.

/** What a repository call does, independent of its surface spelling.
 *
 *  - `load`          — by id; the row must exist (absent → not-found).
 *  - `load-optional` — by id; absent is a value (`T?`).
 *  - `load-by-key`   — by a declared `unique (…)` tuple; the row must exist
 *                      (absent → not-found).
 *  - `load-by-key-optional` — by a declared `unique (…)` tuple; absent is a
 *                      value (`T?`).
 *  - `select-one`    — the first row matching a criterion (`T?`).
 *  - `select-many`   — every row matching a criterion / retrieval, or the whole
 *                      collection when none is given (`T[]`).
 *  - `remove`        — delete the given aggregate.
 *  - `unknown-read`  — a read name no contract verb recognises; it carries no
 *                      result type and is always refused. */
export type RepoOp =
  | "load"
  | "load-optional"
  | "load-by-key"
  | "load-by-key-optional"
  | "select-one"
  | "select-many"
  | "remove"
  | "unknown-read";

/** Whether a call reads or mutates persistence. */
export type RepoFace = "read" | "write";

/** The argument a contract verb takes.
 *
 *  - `id`            — one aggregate id.
 *  - `key`           — named arguments equal to one declared `unique (…)`
 *                      tuple of the aggregate, in any order
 *                      (`Products.getBy(sku: s)`).
 *  - `criterion`     — a criterion reference (`Name` / `Name(args)`).
 *  - `query-or-none` — a criterion or a retrieval reference, optionally with
 *                      `sort:` / `page:`, or no argument (the whole
 *                      collection).
 *  - `entity`        — a loaded aggregate value.
 *
 *  `find` is overloaded on this shape: a criterion reference is the criterion
 *  read, anything else the by-id read (`classifyRepoArg` in
 *  `language/repo-query-arg.ts` decides). */
export type RepoArgShape = "id" | "key" | "criterion" | "query-or-none" | "entity";

/** The value a contract verb yields: the row, an optional row, a list of rows,
 *  or nothing (a write). */
export type RepoResultShape = "row" | "optional-row" | "rows" | "none";

/** Where a verb is accepted.  `body` is a workflow / handler / domain-service
 *  body; `integration-test` is a context `test` body, which reads through the
 *  generated repository by aggregate name (`Order.get(id)`). */
export type RepoVerbPosition = "body" | "integration-test";

/** The surface spellings the contract table offers. */
export type ContractVerb = "get" | "find" | "getBy" | "findBy" | "all" | "remove";

/** The verbs the contract no longer offers, each with the verb that replaced
 *  it (D-REPO-VERBS).  A call spelling one is refused with
 *  `loom.repo-verb-renamed`, naming the replacement. */
export const RETIRED_REPO_VERBS: Readonly<Record<string, ContractVerb>> = {
  getById: "get",
  findById: "find",
  findAll: "all",
  run: "all",
  delete: "remove",
};

/** The verb that replaced a retired one, or `undefined` for a current name. */
export function retiredRepoVerb(name: string): ContractVerb | undefined {
  return Object.hasOwn(RETIRED_REPO_VERBS, name) ? RETIRED_REPO_VERBS[name] : undefined;
}

/** Persistence names that are NOT contract verbs.  A body persists at its exit
 *  (or at the end of a loop iteration / branch), never by statement, so a call
 *  to one of these is refused in a workflow / handler body
 *  (`loom.workflow-explicit-save`) and in a `reading` domain service. */
export type PersistVerb = "save" | "insert" | "update" | "add" | "commit";

/** Every repository method name the toolchain classifies: the contract verbs
 *  plus the persistence names it refuses. */
export type RepoVerb = ContractVerb | PersistVerb;

/** The body effect a repository verb performs (`ir/types/effect-ir.ts`):
 *  `load` reads rows, `delete` removes one, `persist` writes one. */
export type RepoVerbEffect = "load" | "delete" | "persist";

/** Every verb's effect.  A `Record` over the closed `RepoVerb` union, so a new
 *  verb without an effect is a type error here instead of a fallthrough at a
 *  string-set lookup. */
export const REPO_VERB_EFFECT: Readonly<Record<RepoVerb, RepoVerbEffect>> = {
  get: "load",
  find: "load",
  getBy: "load",
  findBy: "load",
  all: "load",
  remove: "delete",
  save: "persist",
  insert: "persist",
  update: "persist",
  add: "persist",
  commit: "persist",
};

/** The effect of a repository method name, or `undefined` for a name that is
 *  not a `RepoVerb` (an unknown method, or a retired verb). */
export function repoVerbEffect(name: string): RepoVerbEffect | undefined {
  return Object.hasOwn(REPO_VERB_EFFECT, name) ? REPO_VERB_EFFECT[name as RepoVerb] : undefined;
}

export interface RepoVerbContract {
  /** The surface spelling. */
  readonly verb: ContractVerb;
  readonly op: RepoOp;
  readonly face: RepoFace;
  readonly args: RepoArgShape;
  readonly result: RepoResultShape;
  /** `page:` is accepted beside the argument. */
  readonly paged: boolean;
  /** `sort:` is accepted beside the argument. */
  readonly sorted: boolean;
  /** The call consumes a chain-borne `ignoring` filter bypass (the matchers
   *  that read it are `matchAllCall` / `matchKeyLookupCall` / `matchFindCall` /
   *  `matchByIdBypassCall` in `ir/lower/repo-read.ts`). */
  readonly ignoring: boolean;
  readonly positions: readonly RepoVerbPosition[];
  /** The repository method the IR names for this read — what the emitters
   *  render against the generated repository (`getById`, `findById`, …).
   *  Emitter vocabulary, never spelled in `.ddd`.  Empty where the method is
   *  derived instead (a natural-key read's `keyLookupMethodName`) or there is
   *  none (a write). */
  readonly method: string;
}

/** The built-in repository verbs.  `find` appears twice — the by-id read and
 *  the criterion read — and the by-id entry comes first, so a lookup by name
 *  alone answers the by-id contract. */
export const REPOSITORY_CONTRACT: readonly RepoVerbContract[] = [
  {
    verb: "get",
    op: "load",
    face: "read",
    args: "id",
    result: "row",
    paged: false,
    sorted: false,
    ignoring: false,
    positions: ["body", "integration-test"],
    method: "getById",
  },
  {
    verb: "find",
    op: "load-optional",
    face: "read",
    args: "id",
    result: "optional-row",
    paged: false,
    sorted: false,
    ignoring: true,
    positions: ["body", "integration-test"],
    method: "findById",
  },
  {
    verb: "find",
    op: "select-one",
    face: "read",
    args: "criterion",
    result: "optional-row",
    paged: false,
    sorted: false,
    ignoring: true,
    positions: ["body"],
    method: "find",
  },
  {
    verb: "getBy",
    op: "load-by-key",
    face: "read",
    args: "key",
    result: "row",
    paged: false,
    sorted: false,
    ignoring: true,
    positions: ["body"],
    method: "",
  },
  {
    verb: "findBy",
    op: "load-by-key-optional",
    face: "read",
    args: "key",
    result: "optional-row",
    paged: false,
    sorted: false,
    ignoring: true,
    positions: ["body"],
    method: "",
  },
  {
    verb: "all",
    op: "select-many",
    face: "read",
    args: "query-or-none",
    result: "rows",
    paged: true,
    sorted: true,
    ignoring: true,
    positions: ["body", "integration-test"],
    method: "findAll",
  },
  {
    verb: "remove",
    op: "remove",
    face: "write",
    args: "entity",
    result: "none",
    paged: false,
    sorted: false,
    ignoring: false,
    positions: ["body"],
    method: "",
  },
];

// Built back to front so the FIRST entry of an overloaded verb (`find`'s by-id
// read) is the one a lookup by name returns.
const BY_VERB: ReadonlyMap<string, RepoVerbContract> = new Map(
  [...REPOSITORY_CONTRACT].reverse().map((c) => [c.verb, c]),
);

/** The contract entry for a surface verb, or `undefined` for a non-contract
 *  name.  For `find` this is the by-id entry; `repositoryVerbFor` resolves
 *  the overload from the argument. */
export function repositoryVerb(name: string): RepoVerbContract | undefined {
  return BY_VERB.get(name);
}

/** The contract entry a call resolves to, given whether its argument is a
 *  criterion reference.  Only `find` is overloaded: a criterion argument is
 *  the criterion read, anything else the by-id read. */
export function repositoryVerbFor(
  name: string,
  criterionArg: boolean,
): RepoVerbContract | undefined {
  if (name === "find" && criterionArg)
    return REPOSITORY_CONTRACT.find((c) => c.verb === "find" && c.args === "criterion");
  return BY_VERB.get(name);
}

/** The canonical op of a surface verb, or `undefined` when the name is not a
 *  contract verb. */
export function repoVerbOp(name: string): RepoOp | undefined {
  return BY_VERB.get(name)?.op;
}

/** True when the named repository call mutates persistence: a `delete` or
 *  `persist` verb.  Every other name is a read. */
export function isRepoWriteName(name: string): boolean {
  const effect = repoVerbEffect(name);
  return effect === "delete" || effect === "persist";
}

/** True when the name is a contract verb accepted at `position`. */
export function isRepoVerbAt(name: string, position: RepoVerbPosition): boolean {
  return BY_VERB.get(name)?.positions.includes(position) ?? false;
}

/** The canonical op of a contract verb accepted at `position`, or `undefined`
 *  when the name is not one there. */
export function repoVerbOpAt(name: string, position: RepoVerbPosition): RepoOp | undefined {
  const c = BY_VERB.get(name);
  return c?.positions.includes(position) ? c.op : undefined;
}

/** The repository method a by-name contract read is emitted as (`get` →
 *  `getById`, `find(id)` → `findById`, `all()` → `findAll`); any other name
 *  is its own method. */
export function repoVerbMethod(name: string): string {
  const c = BY_VERB.get(name);
  return c?.method ? c.method : name;
}

/** The surface spelling of a canonical op that takes `args` — the inverse
 *  lookup, used where a diagnostic or a synthesised call has to SPELL a verb
 *  (`load` → `get`).  The first matching table entry wins. */
export function repoOpVerb(op: RepoOp, args?: RepoArgShape): string {
  const hit = REPOSITORY_CONTRACT.find((c) => c.op === op && (!args || c.args === args));
  if (!hit) throw new Error(`repository contract has no verb for op '${op}'`);
  return hit.verb;
}

/** The canonical op of a by-name repository call `Repo.<name>(…)` — one whose
 *  argument is a plain value (`get(id)`, `find(id)`, `all()`).  `undefined`
 *  for a name that is not a contract verb, and for the natural-key reads,
 *  which only `matchKeyLookupCall` recognises (it resolves their named
 *  arguments against the declared tuples). */
export function namedRepoCallOp(name: string): RepoOp | undefined {
  const c = BY_VERB.get(name);
  if (!c || c.args === "key") return undefined;
  return c.op;
}

/** The result shape of a canonical op.  `unknown-read` has none. */
export function repoOpResult(op: Exclude<RepoOp, "unknown-read">): RepoResultShape {
  const hit = REPOSITORY_CONTRACT.find((c) => c.op === op);
  if (!hit) throw new Error(`repository contract has no verb for op '${op}'`);
  return hit.result;
}

/** True for the two natural-key reads (`getBy` / `findBy`). */
export function isKeyLookupOp(op: RepoOp): op is "load-by-key" | "load-by-key-optional" {
  return op === "load-by-key" || op === "load-by-key-optional";
}

/** The repository method a natural-key read is emitted as: the verb, `By`,
 *  then the tuple's columns in their declared order joined by `And`
 *  (`findBy` over `(sku)` → `findBySku`; `getBy` over `(tenant, code)` →
 *  `getByTenantAndCode`).  A read that bypasses capability filters gets its
 *  own method, so the stance is part of the name: `ignoring *` →
 *  `…IgnoringAll`, `ignoring softDeletable` → `…IgnoringSoftDeletable`.
 *  Every backend renders this one name through its own find-method escaping. */
export function keyLookupMethodName(
  verb: "getBy" | "findBy",
  columns: readonly string[],
  bypass?: ReadBypass,
): string {
  return `${verb}${columns.map(capFirst).join("And")}${bypassSuffix(bypass)}`;
}

/** An `ignoring` stance as the IR carries it. */
export interface ReadBypass {
  bypassAll?: boolean;
  bypassCaps?: readonly string[];
}

const capFirst = (s: string): string => (s.length ? s[0]!.toUpperCase() + s.slice(1) : s);

/** The method-name suffix that spells an `ignoring` stance: `ignoring *` →
 *  `IgnoringAll`, `ignoring A, B` → `IgnoringAAndB` (capability names sorted,
 *  so the order they are written in never picks a different method), no
 *  stance → `""`. */
export function bypassSuffix(bypass?: ReadBypass): string {
  if (bypass?.bypassAll) return "IgnoringAll";
  const caps = bypass?.bypassCaps ?? [];
  return caps.length > 0 ? `Ignoring${[...caps].sort().map(capFirst).join("And")}` : "";
}

/** The retrieval a list read (`Repo.all(<Criterion | Retrieval>)`) runs.  A
 *  plain read runs the shared retrieval (`findAllBy<C>` / the declared one);
 *  a widened read runs its own, with the stance in its name, so the filters
 *  every other caller of the shared retrieval relies on stay on:
 *
 *    Orders.all(Big())             → findAllByBig
 *    Orders.all(Big()) ignoring *  → findAllByBigIgnoringAll
 *    Orders.all(Recent) ignoring softDeletable → RecentIgnoringSoftDeletable */
export function widenedRetrievalName(retrieval: string, bypass?: ReadBypass): string {
  return `${retrieval}${bypassSuffix(bypass)}`;
}

/** The shared retrieval a widened list read's retrieval derives from — the
 *  inverse of `widenedRetrievalName`. */
export function retrievalBaseName(retrieval: string, bypass?: ReadBypass): string {
  const suffix = bypassSuffix(bypass);
  return suffix && retrieval.endsWith(suffix) ? retrieval.slice(0, -suffix.length) : retrieval;
}

/** The repository method a single-row read that widens its capability filters
 *  is emitted as.  The plain reads run against shared methods (`find(C)` the
 *  criterion's `findAllBy<C>` retrieval, `find(id)` the by-id load) whose
 *  filters every other caller relies on, so a widened read gets a method of
 *  its own, with the stance in its name:
 *
 *    Orders.find(ByRef(r)) ignoring softDeletable → findFirstByRefIgnoringSoftDeletable
 *    Orders.find(id) ignoring *                  → findByIdIgnoringAll
 *
 *  `findFirst` keeps a criterion read apart from a natural-key read over a
 *  column of the same spelling (`findBy` over `(ref)` is `findByRef…`). */
export function bypassReadMethodName(
  source: { kind: "criterion"; name: string } | { kind: "id" },
  bypass: ReadBypass,
): string {
  const base = source.kind === "id" ? "findById" : `findFirst${capFirst(source.name)}`;
  return `${base}${bypassSuffix(bypass)}`;
}

/** How a natural-key read's named arguments line up with the aggregate's
 *  declared `unique (…)` tuples.
 *
 *  - `match`      — the argument names equal one tuple exactly (any order);
 *                   `tuple` is that tuple in its declared column order.
 *  - `incomplete` — the names are a strict subset of a tuple; `tuple` is the
 *                   smallest such tuple and `missing` its absent columns.
 *  - `positional` — an argument has no name.
 *  - `not-unique` — no tuple covers the names. */
export type KeyTupleResolution =
  | { readonly kind: "match"; readonly tuple: readonly string[] }
  | {
      readonly kind: "incomplete";
      readonly tuple: readonly string[];
      readonly missing: readonly string[];
    }
  | { readonly kind: "positional" }
  | { readonly kind: "not-unique" };

/** Match a natural-key read's argument names (`undefined` for a positional
 *  argument) against the declared `unique (…)` tuples.  The one rule
 *  validation and lowering share. */
export function resolveKeyTuple(
  argNames: readonly (string | undefined)[],
  tuples: readonly (readonly string[])[],
): KeyTupleResolution {
  if (argNames.some((n) => n === undefined)) return { kind: "positional" };
  const names = new Set(argNames as string[]);
  for (const t of tuples) {
    if (t.length === names.size && t.every((c) => names.has(c))) return { kind: "match", tuple: t };
  }
  let best: readonly string[] | undefined;
  for (const t of tuples) {
    const set = new Set(t);
    if (t.length > names.size && [...names].every((n) => set.has(n))) {
      if (!best || t.length < best.length) best = t;
    }
  }
  if (best) return { kind: "incomplete", tuple: best, missing: best.filter((c) => !names.has(c)) };
  return { kind: "not-unique" };
}

/** The `detail` a FIND's absence answers with (optional or single) — a machine
 *  token, deliberately not the by-id `not-found` sentence (RS-27 scope).  A
 *  single-row read route that replaces a find (`scaffoldGet`) answers its miss
 *  with the same token, so the route keeps the find's 404 body. */
export const FIND_ABSENT_DETAIL = "not_found";

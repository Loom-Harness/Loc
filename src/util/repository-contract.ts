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
// A name that is not a contract verb is either a DECLARED find (a `find` in the
// repository body, called by its own name; op `declared-find`) or one of the
// persistence names the contract does not offer (`save`, `insert`, …), which
// classify as writes.

/** What a repository call does, independent of its surface spelling.
 *
 *  - `load`          — by id; the row must exist (absent → not-found).
 *  - `load-optional` — by id; absent is a value (`T?`).
 *  - `select-one`    — the first row matching a criterion (`T?`).
 *  - `select-many`   — every row matching a criterion / retrieval, or the whole
 *                      collection when none is given (`T[]`).
 *  - `remove`        — delete the given aggregate.
 *  - `declared-find` — a find declared in the repository body, called by its
 *                      own name; its declaration carries the result type. */
export type RepoOp =
  | "load"
  | "load-optional"
  | "select-one"
  | "select-many"
  | "remove"
  | "declared-find";

/** Whether a call reads or mutates persistence. */
export type RepoFace = "read" | "write";

/** The argument a contract verb takes.
 *
 *  - `id`                     — one aggregate id.
 *  - `none`                   — no argument.
 *  - `criterion`              — a criterion reference (`Name` / `Name(args)`).
 *  - `criterion-or-none`      — a criterion reference, or no argument (the
 *                               whole collection).
 *  - `retrieval-or-criterion` — a retrieval reference, an anonymous retrieval
 *                               literal, or a criterion reference.
 *  - `entity`                 — a loaded aggregate value. */
export type RepoArgShape =
  | "id"
  | "none"
  | "criterion"
  | "criterion-or-none"
  | "retrieval-or-criterion"
  | "entity";

/** The value a contract verb yields: the row, an optional row, a list of rows,
 *  or nothing (a write). */
export type RepoResultShape = "row" | "optional-row" | "rows" | "none";

/** Where a verb is accepted.  `body` is a workflow / handler / domain-service
 *  body; `integration-test` is a context `test` body, which reads through the
 *  generated repository by aggregate name (`Order.getById(id)`). */
export type RepoVerbPosition = "body" | "integration-test";

export interface RepoVerbContract {
  /** The surface spelling accepted today. */
  readonly verb: string;
  readonly op: RepoOp;
  readonly face: RepoFace;
  readonly args: RepoArgShape;
  readonly result: RepoResultShape;
  /** `page:` is accepted beside the argument. */
  readonly paged: boolean;
  /** The call consumes a chain-borne `ignoring` filter bypass (the matchers
   *  that read it are `matchRetrievalRunCall` / `matchFindAllCall` in
   *  `ir/lower/repo-read.ts`). */
  readonly ignoring: boolean;
  readonly positions: readonly RepoVerbPosition[];
}

/** The built-in repository verbs. */
export const REPOSITORY_CONTRACT: readonly RepoVerbContract[] = [
  {
    verb: "getById",
    op: "load",
    face: "read",
    args: "id",
    result: "row",
    paged: false,
    ignoring: false,
    positions: ["body", "integration-test"],
  },
  {
    verb: "findById",
    op: "load-optional",
    face: "read",
    args: "id",
    result: "optional-row",
    paged: false,
    ignoring: false,
    positions: ["body", "integration-test"],
  },
  {
    verb: "find",
    op: "select-one",
    face: "read",
    args: "criterion",
    result: "optional-row",
    paged: false,
    ignoring: false,
    positions: ["body"],
  },
  {
    verb: "findAll",
    op: "select-many",
    face: "read",
    args: "criterion-or-none",
    result: "rows",
    paged: true,
    ignoring: true,
    positions: ["body", "integration-test"],
  },
  {
    verb: "all",
    op: "select-many",
    face: "read",
    args: "none",
    result: "rows",
    paged: false,
    ignoring: false,
    positions: ["body"],
  },
  {
    verb: "run",
    op: "select-many",
    face: "read",
    args: "retrieval-or-criterion",
    result: "rows",
    paged: true,
    ignoring: true,
    positions: ["body"],
  },
  {
    verb: "delete",
    op: "remove",
    face: "write",
    args: "entity",
    result: "none",
    paged: false,
    ignoring: false,
    positions: ["body"],
  },
  {
    verb: "remove",
    op: "remove",
    face: "write",
    args: "entity",
    result: "none",
    paged: false,
    ignoring: false,
    positions: ["body"],
  },
];

/** Persistence names that are not contract verbs.  A call to one of them is a
 *  write: a `reading` domain service refuses it, and a workflow body lowers it
 *  as a write statement. */
const NON_CONTRACT_WRITE_NAMES: ReadonlySet<string> = new Set([
  "save",
  "insert",
  "update",
  "add",
  "commit",
]);

const BY_VERB: ReadonlyMap<string, RepoVerbContract> = new Map(
  REPOSITORY_CONTRACT.map((c) => [c.verb, c]),
);

/** The contract entry for a surface verb, or `undefined` for a declared find
 *  name / a non-contract name. */
export function repositoryVerb(name: string): RepoVerbContract | undefined {
  return BY_VERB.get(name);
}

/** The canonical op of a surface verb, or `undefined` when the name is not a
 *  contract verb. */
export function repoVerbOp(name: string): RepoOp | undefined {
  return BY_VERB.get(name)?.op;
}

/** True when the named repository call mutates persistence: a write-face
 *  contract verb, or a non-contract persistence name.  Every other name (a
 *  contract read, a declared find) is a read. */
export function isRepoWriteName(name: string): boolean {
  return BY_VERB.get(name)?.face === "write" || NON_CONTRACT_WRITE_NAMES.has(name);
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

/** The surface spelling of a canonical op that takes `args` — the inverse
 *  lookup, used where a diagnostic or a synthesised call has to SPELL a verb
 *  (`load` → `getById`).  The first matching table entry wins. */
export function repoOpVerb(op: RepoOp, args?: RepoArgShape): string {
  const hit = REPOSITORY_CONTRACT.find((c) => c.op === op && (!args || c.args === args));
  if (!hit) throw new Error(`repository contract has no verb for op '${op}'`);
  return hit.verb;
}

/** The canonical op of a named repository call `Repo.<name>(…)`: a declared
 *  find wins (it is the repository's own contract and is called under its own
 *  name), otherwise the contract verb's op.  `undefined` for a name that is
 *  neither. */
export function namedRepoCallOp(name: string, isDeclaredFind: boolean): RepoOp | undefined {
  if (isDeclaredFind) return "declared-find";
  const c = BY_VERB.get(name);
  // A verb whose argument is a criterion / retrieval REFERENCE is that verb
  // only when the reference is recognised (the reference matchers in
  // `ir/lower/repo-read.ts` own that); called with anything else it is not.
  if (!c || c.args === "criterion" || c.args === "retrieval-or-criterion") return undefined;
  return c.op;
}

/** The result shape of a canonical op.  `declared-find` has none of its own —
 *  its declaration carries the type. */
export function repoOpResult(op: Exclude<RepoOp, "declared-find">): RepoResultShape {
  const hit = REPOSITORY_CONTRACT.find((c) => c.op === op);
  if (!hit) throw new Error(`repository contract has no verb for op '${op}'`);
  return hit.result;
}

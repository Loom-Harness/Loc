// Shared repo-read recognition — the IR-layer detector for a repository
// READ call (`Repo.get(id)` / `Repo.find(id)` / `Repo.find(<Criterion>)` /
// `Repo.getBy(…)` / `Repo.findBy(…)` / `Repo.all(<Criterion | Retrieval>,
// sort?, page?)` / `Repo.all()`) over the raw `.ddd` AST.
//
// This is the single source of truth for "is this expression a repository
// read", consumed by BOTH the workflow lowerer (`lower-workflow.ts`, which
// lowers a recognised read to a `repo-run` / `repo-let` `WorkflowStmtIR`)
// AND the domain-service lowerer (`lower-domain-service.ts`, which lowers a
// recognised read to a resolved `repo-read` `ExprIR` Call so a service body
// can run read-only queries — domain-services.md rev. 4, the `reading` tier).
//
// The surface verb never reaches the IR: every match names the repository
// METHOD the read is emitted as (`get` → `getById`, `find(id)` → `findById`,
// `all()` → `findAll`, a criterion / retrieval read its retrieval), so the
// emitters render the same calls whatever the `.ddd` spelled (D-REPO-VERBS).
//
// It is a LEAF: it touches the Langium AST + the `Repository` shape, plus
// `lower-types.ts` (itself a sibling leaf with no sibling imports of its own, so
// the graph stays acyclic) for the ONE thing a read's shape decides but the AST
// cannot spell on its own — the IR TYPE the read produces, see
// `repoReadResultType` below.  It never imports `lower.ts` (the orchestrator and
// the leaf lowerers import this).
import type { Expression, LoadPath, Repository, SortItem } from "../../language/generated/ast.js";
import {
  isMemberSuffix,
  isNameRef,
  isObjectLit,
  isPostfixChain,
} from "../../language/generated/ast.js";
import { callableKeyTuples } from "../../language/repo-key-tuples.js";
import { classifyRepoArg, type QueryNames, queryRefOf } from "../../language/repo-query-arg.js";
import {
  bypassReadMethodName,
  isRepoWriteName,
  keyLookupMethodName,
  namedRepoCallOp,
  type RepoOp,
  repoOpResult,
  repositoryVerb,
  repoVerbMethod,
  resolveKeyTuple,
  widenedRetrievalName,
} from "../../util/repository-contract.js";
import type { BypassReadIR, KeyLookupIR, TypeIR } from "../types/loom-ir.js";

const NO_QUERIES: QueryNames = { criteria: new Set(), retrievals: new Set() };

export interface RepoMatch {
  repo: Repository;
  /** The surface verb the call spelled (`get`, `find`, `all`, …). */
  verb: string;
  /** The repository method the read is emitted as (`repoVerbMethod`:
   *  `get` → `getById`); a name that is no contract verb is its own method. */
  method: string;
  args: Expression[];
}

/** Recognise `<Repo>.<verb>(args)` — a by-name repository call (`get(id)`,
 *  `find(id)`, `all()`, or a name no contract verb recognises).  Exactly one
 *  `MemberSuffix` with a call payload whose head names a repository.  The
 *  CallArg wrappers are peeled to bare value expressions. */
export function matchRepoCall(
  expr: Expression | undefined,
  reposByName: Map<string, Repository>,
): RepoMatch | undefined {
  if (!expr || !isPostfixChain(expr)) return undefined;
  if (expr.suffixes.length !== 1) return undefined;
  const s = expr.suffixes[0]!;
  if (!isMemberSuffix(s) || !s.call) return undefined;
  const recv = expr.head;
  if (!isNameRef(recv)) return undefined;
  const repo = reposByName.get(recv.name);
  if (!repo) return undefined;
  return {
    repo,
    verb: s.member,
    method: repoVerbMethod(s.member),
    args: (s.args ?? []).map((a) => a.value),
  };
}

/** A natural-key read — `Repo.getBy(<col>: v, …)` / `Repo.findBy(…)`. */
export interface KeyLookupMatch {
  repo: Repository;
  verb: "getBy" | "findBy";
  op: "load-by-key" | "load-by-key-optional";
  /** The repository method the read is emitted as (`keyLookupMethodName`):
   *  one per (verb, tuple, `ignoring` stance). */
  method: string;
  /** The tuple's columns in their declared order — the method's parameters. */
  columns: string[];
  /** The argument values, in `columns` order. */
  args: Expression[];
  bypassAll?: boolean;
  bypassCaps?: string[];
}

/** Recognise `<Repo>.getBy(<col>: v, …)` / `<Repo>.findBy(…)`.  The named
 *  arguments are matched against the aggregate's declared `unique (…)` tuples
 *  (`resolveKeyTuple`) and re-ordered into the tuple's declared column order,
 *  so a call's argument order never changes the method it calls.  A call that
 *  names no declared tuple keeps its own argument order; phase ④ has already
 *  refused it (`loom.repo-key-not-unique` / `loom.repo-key-incomplete`). */
export function matchKeyLookupCall(
  expr: Expression | undefined,
  reposByName: Map<string, Repository>,
): KeyLookupMatch | undefined {
  if (!expr || !isPostfixChain(expr) || expr.suffixes.length !== 1) return undefined;
  const s = expr.suffixes[0]!;
  if (!isMemberSuffix(s) || !s.call) return undefined;
  const c = repositoryVerb(s.member);
  if (c?.args !== "key") return undefined;
  const recv = expr.head;
  if (!isNameRef(recv)) return undefined;
  const repo = reposByName.get(recv.name);
  if (!repo) return undefined;
  const callArgs = s.args ?? [];
  const res = resolveKeyTuple(
    callArgs.map((a) => a.name),
    callableKeyTuples(repo.aggregate?.ref, expr),
  );
  const own = callArgs.map((a, i) => a.name ?? `arg${i}`);
  const columns = res.kind === "match" ? [...res.tuple] : own;
  const byName = new Map(callArgs.map((a, i) => [own[i]!, a.value]));
  const args = columns.flatMap((col) => {
    const v = byName.get(col);
    return v ? [v] : [];
  });
  const bypass = chainBypass(expr);
  const verb = s.member as "getBy" | "findBy";
  return {
    repo,
    verb,
    op: c.op as "load-by-key" | "load-by-key-optional",
    method: keyLookupMethodName(verb, columns, bypass),
    columns,
    args,
    ...bypass,
  };
}

/** The `ignoring` stance a read chain carries: `ignoring *` → `bypassAll`,
 *  `ignoring A, B` → `bypassCaps`, none → `{}`. */
function chainBypass(expr: { bypassAll?: boolean; bypass?: string[] }): {
  bypassAll?: boolean;
  bypassCaps?: string[];
} {
  if (expr.bypassAll) return { bypassAll: true };
  return (expr.bypass?.length ?? 0) > 0 ? { bypassCaps: [...expr.bypass!] } : {};
}

/** The widened single-row read a chain names, when it carries an `ignoring`
 *  stance — `undefined` for a plain read. */
function bypassReadOf(
  expr: { bypassAll?: boolean; bypass?: string[] },
  source: BypassReadIR["source"],
): BypassReadIR | undefined {
  const bypass = chainBypass(expr);
  return bypass.bypassAll || bypass.bypassCaps ? { source, ...bypass } : undefined;
}

/** The method a widened single-row read is emitted as. */
export function bypassReadMethod(read: BypassReadIR): string {
  return bypassReadMethodName(read.source, read);
}

/** The IR record of a natural-key read's tuple + `ignoring` stance. */
export function keyLookupIR(m: KeyLookupMatch): KeyLookupIR {
  return {
    columns: m.columns,
    ...(m.bypassAll ? { bypassAll: true } : {}),
    ...(m.bypassCaps ? { bypassCaps: m.bypassCaps } : {}),
  };
}

export interface FindMatch {
  repo: Repository;
  criterionName: string;
  criterionArgs: Expression[];
  /** Set when the read carries an `ignoring` stance: it then calls its own
   *  method (`bypassReadMethod`) instead of the criterion's shared retrieval. */
  bypassRead?: BypassReadIR;
}

/** The single member-call suffix of `<Repo>.<verb>(…)` and its repository. */
function repoVerbCall(
  expr: Expression | undefined,
  reposByName: Map<string, Repository>,
  verb: string,
) {
  if (!expr || !isPostfixChain(expr) || expr.suffixes.length !== 1) return undefined;
  const s = expr.suffixes[0]!;
  if (!isMemberSuffix(s) || !s.call || s.member !== verb) return undefined;
  const recv = expr.head;
  if (!isNameRef(recv)) return undefined;
  const repo = reposByName.get(recv.name);
  if (!repo) return undefined;
  return { chain: expr, suffix: s, repo };
}

/** Recognise `<Repo>.find(<CriterionRef>)` — the first row a criterion
 *  matches (criterion.md, use site 3).  No `page:` (a single result isn't
 *  paginated); the only arg is a reference to a declared criterion (bare
 *  `Name` or `Name(args)`).  `find` over anything else is the by-id read, so
 *  this declines (→ `undefined`). */
export function matchFindCall(
  expr: Expression | undefined,
  reposByName: Map<string, Repository>,
  names: QueryNames = NO_QUERIES,
): FindMatch | undefined {
  const call = repoVerbCall(expr, reposByName, "find");
  if (!call) return undefined;
  const refArg = (call.suffix.args ?? []).find((a) => !a.name);
  if (!refArg || classifyRepoArg(refArg.value, names) !== "criterion") return undefined;
  const critRef = queryRefOf(refArg.value)!;
  const bypassRead = bypassReadOf(call.chain, { kind: "criterion", name: critRef.name });
  return {
    repo: call.repo,
    criterionName: critRef.name,
    criterionArgs: critRef.args,
    ...(bypassRead ? { bypassRead } : {}),
  };
}

/** Recognise `<Repo>.find(id) ignoring …` — the by-id read widened past its
 *  capability filters.  A plain `find(id)` declines: it is the shared by-id
 *  load, called by name.  A criterion `find` is `matchFindCall`'s. */
export function matchByIdBypassCall(
  expr: Expression | undefined,
  reposByName: Map<string, Repository>,
  names: QueryNames = NO_QUERIES,
): (RepoMatch & { bypassRead: BypassReadIR }) | undefined {
  const call = matchRepoCall(expr, reposByName);
  if (call?.verb !== "find" || !isPostfixChain(expr)) return undefined;
  if (classifyRepoArg(call.args[0], names) === "criterion") return undefined;
  const bypassRead = bypassReadOf(expr, { kind: "id" });
  return bypassRead ? { ...call, bypassRead } : undefined;
}

export interface AllMatch {
  repo: Repository;
  /** The referenced (named) retrieval; empty for a criterion read. */
  retrievalName: string;
  retrievalArgs: Expression[];
  /** Set for a criterion read — `all(<Criterion>, sort: […])`.  Lowers to a
   *  `synthCriterion` repo-run, materialised by enrich into a synthetic
   *  `findAllBy<Criterion>` retrieval that carries the `sort:` terms. */
  anon?: {
    criterionName: string;
    criterionArgs: Expression[];
    sort: SortItem[];
    loads: LoadPath[];
  };
  /** The `page:` object-literal argument's fields, if supplied. */
  pageOffset?: Expression;
  pageLimit?: Expression;
}

/** Recognise `<Repo>.all(<Ref>, sort?, page?)` — every row a criterion or a
 *  retrieval selects.  The positional argument is a reference (`Name` /
 *  `Name(args)`): a declared criterion rides the synthetic-criterion path
 *  (it desugars to `findAllBy<Criterion>`, shaped by `sort:`), any other
 *  reference names a retrieval (an undeclared one is refused by
 *  `loom.workflow-unknown-retrieval`).  An optional named `page:` carries an
 *  object literal `{ offset?, limit? }`.  `all()` with no reference is the
 *  whole collection — a by-name read, so this declines. */
export function matchAllCall(
  expr: Expression | undefined,
  reposByName: Map<string, Repository>,
  names: QueryNames = NO_QUERIES,
): AllMatch | undefined {
  const call = repoVerbCall(expr, reposByName, "all");
  if (!call) return undefined;
  const callArgs = call.suffix.args ?? [];
  const refArg = callArgs.find((a) => !a.name);
  const ref = queryRefOf(refArg?.value);
  if (!ref) return undefined;
  const page: { pageOffset?: Expression; pageLimit?: Expression } = {};
  const pageArg = callArgs.find((a) => a.name === "page");
  if (pageArg && isObjectLit(pageArg.value)) {
    for (const f of pageArg.value.fields) {
      if (f.name === "offset") page.pageOffset = f.value;
      else if (f.name === "limit") page.pageLimit = f.value;
    }
  }
  if (classifyRepoArg(refArg!.value, names) === "criterion") {
    return {
      repo: call.repo,
      retrievalName: "",
      retrievalArgs: [],
      anon: {
        criterionName: ref.name,
        criterionArgs: ref.args,
        sort: call.suffix.sort ?? [],
        loads: [],
      },
      ...page,
    };
  }
  return { repo: call.repo, retrievalName: ref.name, retrievalArgs: ref.args, ...page };
}

export interface RepoReadMatch {
  /** What the read does (`util/repository-contract.ts`) — the discriminator the
   *  domain-service read lowerer stamps onto the resolved `repo-read` Call so a
   *  backend renders the right find-method without re-recognising the AST
   *  shape. */
  op: Exclude<RepoOp, "remove">;
  repo: Repository;
  /** The find / retrieval / criterion method name to render against the repo. */
  method: string;
  /** Positional argument expressions (criterion / find args), lowered by the
   *  caller in its own scope. */
  args: Expression[];
  /** For a criterion `find` / `all` — the referenced criterion name.  The
   *  read FILTERS by this criterion; without carrying it the criterion is
   *  silently dropped and the read returns every row (data-exposure).  Drives
   *  the synthesis of the `findAllBy<Criterion>` retrieval the backend renders. */
  criterionName?: string;
  /** For `all(<Retrieval>)` — the referenced retrieval.  Empty for a plain
   *  criterion read, whose predicate rides `criterionName` instead.  A widened
   *  list read (`listBypass`) names its own retrieval here, criterion or not. */
  retrievalName?: string;
  /** For a natural-key read — the tuple and `ignoring` stance `method`
   *  names. */
  key?: KeyLookupIR;
  /** For a widened `find(C)` / `find(id)` read — the source and stance
   *  `method` names. */
  bypassRead?: BypassReadIR;
  /** For a widened `all(<Ref>) ignoring …` read — the stance its own
   *  retrieval (`retrievalName`, named by `widenedRetrievalName`) carries. */
  listBypass?: { bypassAll?: boolean; bypassCaps?: string[] };
}

/** Recognise ANY repository read in an expression position, collapsing the
 *  read shapes to one `RepoReadMatch` for the domain-service `reading` tier.
 *  Tries the specific forms (natural key / criterion `find` / widened by-id /
 *  `all(<Ref>)`) before the by-name form, mirroring the precedence the
 *  workflow let-lowerer uses.  Returns `undefined` for a non-read (a WRITE like
 *  `remove` falls through here — it is NOT a read, so the validator's
 *  repo-WRITE gate rejects it). */
export function matchRepoRead(
  expr: Expression | undefined,
  reposByName: Map<string, Repository>,
  names: QueryNames = NO_QUERIES,
): RepoReadMatch | undefined {
  const key = matchKeyLookupCall(expr, reposByName);
  if (key)
    return {
      op: key.op,
      repo: key.repo,
      method: key.method,
      args: key.args,
      key: keyLookupIR(key),
    };
  const find = matchFindCall(expr, reposByName, names);
  if (find?.bypassRead)
    return {
      op: "select-one",
      repo: find.repo,
      method: bypassReadMethod(find.bypassRead),
      args: find.criterionArgs,
      bypassRead: find.bypassRead,
    };
  if (find)
    return {
      op: "select-one",
      repo: find.repo,
      method: "find",
      args: find.criterionArgs,
      criterionName: find.criterionName,
    };
  const byId = matchByIdBypassCall(expr, reposByName, names);
  if (byId)
    return {
      op: "load-optional",
      repo: byId.repo,
      method: bypassReadMethod(byId.bypassRead),
      args: byId.args,
      bypassRead: byId.bypassRead,
    };
  const all = matchAllCall(expr, reposByName, names);
  if (all) {
    // A widened list read (`all(<Ref>) ignoring …`) runs a retrieval of its
    // own, named for its stance, exactly as the workflow `repo-run` arm does —
    // the shared retrieval every other caller runs keeps its filters.
    const stance: { bypassAll?: boolean; bypassCaps?: string[] } = isPostfixChain(expr)
      ? chainBypass(expr)
      : {};
    const widened = stance.bypassAll || stance.bypassCaps;
    return {
      op: "select-many",
      repo: all.repo,
      method: all.anon ? "findAll" : "run",
      args: all.anon ? all.anon.criterionArgs : all.retrievalArgs,
      ...(all.anon ? { criterionName: all.anon.criterionName } : {}),
      ...(all.anon && !widened
        ? {}
        : {
            retrievalName: widenedRetrievalName(
              all.anon ? `findAllBy${all.anon.criterionName}` : all.retrievalName,
              stance,
            ),
          }),
      ...(widened ? { listBypass: stance } : {}),
    };
  }
  const repo = matchRepoCall(expr, reposByName);
  if (repo && !isRepoWriteName(repo.verb)) {
    // A read name that is no contract verb rides `unknown-read`: its
    // validator reports the unknown method.
    const op = namedRepoCallOp(repo.verb) ?? "unknown-read";
    if (op === "remove") return undefined;
    return { op, repo: repo.repo, method: repo.method, args: repo.args };
  }
  return undefined;
}

/** The IR type a recognised repository READ produces — i.e. the type a `let`
 *  binds when its initialiser is one.
 *
 *  This lives HERE, beside the detector, because the two are one fact: the
 *  read's recognised SHAPE is exactly what decides its result type, and the
 *  `.ddd` source never spells that type out.  Splitting them is how the pair
 *  drifts — which is the bug this function was added to close.  A let-bound
 *  repo read in a `domainService` body was typed by `passType`, whose
 *  PostfixChain arm has a probe for every OTHER resolved call shape (store
 *  field, api operation, domain-service operation — each commented "without
 *  this `let`-binds would mis-type as `string`") but had none for a repository
 *  read.  So `let f = Owners.byTier(t)` fell through to `memberType`'s `string`
 *  default and EVERY member read off `f` was then wrong: `f.count` emitted
 *  verbatim (TS2339 on `Owner[]`), `f.length` took the grapheme-safe STRING
 *  lowering (`[...f].length`), and an invented `f.nope` sailed through because
 *  the unknown-member gate never sees a `string` receiver as suspect.
 *
 *  The rules track `lower-workflow.ts`, which lowers the same four shapes on
 *  the workflow tier, so the two tiers cannot disagree about what one read
 *  returns: `all` mirrors its `repo-run` arms' `arrayType`, `named`
 *  mirrors its `repo-let` arm (a declared `returnType`, else the built-in's own
 *  shape), and `find` takes the `T?` its `if let` arm implies. */
export function repoReadResultType(read: RepoReadMatch): TypeIR {
  const entity: TypeIR = {
    kind: "entity",
    name: read.repo.aggregate?.ref?.name ?? "Unknown",
    declKind: "aggregate",
  };
  // An unknown named read falls back to the bare aggregate, like the workflow
  // `repo-let` arm; its validator refuses it.
  if (read.op === "unknown-read") return entity;
  return repoResultTypeIR(read.op, entity);
}

/** The IR type of a contract read's result over `entity`, from the op's
 *  result shape in `util/repository-contract.ts`.  The by-id reads do NOT share
 *  one shape: `load` is the row (it throws → 404 when absent), `load-optional`
 *  is `T?`.  Typing the optional read as a bare entity is a lie the whole
 *  pipeline then believes — no nullable gate fires and no backend guards the
 *  dereference.  `select-one` is the `T?` an `if let` source unwraps, and
 *  `select-many` is the row array, so a member read off it (`.count`) takes
 *  the collection lowering. */
function repoResultTypeIR(op: Exclude<RepoOp, "unknown-read">, entity: TypeIR): TypeIR {
  switch (repoOpResult(op)) {
    case "optional-row":
      return { kind: "optional", inner: entity };
    case "rows":
      return { kind: "array", element: entity };
    case "row":
    case "none":
      return entity;
  }
}

/** Repository WRITE method names — a call on a repository naming one of these
 *  is a persistence mutation, forbidden in a `reading` domain service.  A
 *  non-write, non-find named call is treated as a read (a declared `find`). */

// Shared repo-read recognition — the IR-layer detector for a repository
// READ call (`Repo.find(<Criterion>)` / `Repo.findAll(<Criterion>, page?)` /
// `Repo.run(<Retrieval>(args), page?)` / `Repo.<namedFind>(args)`) over the
// raw `.ddd` AST.
//
// This is the single source of truth for "is this expression a repository
// read", consumed by BOTH the workflow lowerer (`lower-workflow.ts`, which
// lowers a recognised read to a `repo-run` / `repo-let` `WorkflowStmtIR`)
// AND the domain-service lowerer (`lower-domain-service.ts`, which lowers a
// recognised read to a resolved `repo-read` `ExprIR` Call so a service body
// can run read-only queries — domain-services.md rev. 4, the `reading` tier).
//
// It is a LEAF: it touches the Langium AST + the `Repository` shape, plus
// `lower-types.ts` (itself a sibling leaf with no sibling imports of its own, so
// the graph stays acyclic) for the ONE thing a read's shape decides but the AST
// cannot spell on its own — the IR TYPE the read produces, see
// `repoReadResultType` below.  It never imports `lower.ts` (the orchestrator and
// the leaf lowerers import this).  Extracting it is a PURE refactor of the
// workflow path: the matchers below are byte-for-byte the ones that lived in
// `lower-workflow.ts`, so workflow lowering output is unchanged.
import type {
  BoundedContext,
  Expression,
  LoadPath,
  Repository,
  SortItem,
} from "../../language/generated/ast.js";
import {
  isCallSuffix,
  isCriterion,
  isMemberSuffix,
  isNameRef,
  isObjectLit,
  isPostfixChain,
  isRetrieval,
  isRetrievalLiteral,
} from "../../language/generated/ast.js";
import { declaredKeyTuples } from "../../language/repo-key-tuples.js";
import {
  isRepoWriteName,
  keyLookupMethodName,
  namedRepoCallOp,
  type RepoOp,
  repoOpResult,
  repositoryVerb,
  resolveKeyTuple,
} from "../../util/repository-contract.js";
import type { KeyLookupIR, TypeIR } from "../types/loom-ir.js";
import { type Env, lowerType } from "./lower-types.js";

/** A predicate that decides whether a bare `run(<Name>)` / `run(<Name>(args))`
 *  target names a **criterion** (so the read runs `findAllBy<Criterion>`) rather
 *  than a **retrieval** (read-path-architecture.md, "`run` takes a criterion").
 *  A name that is BOTH is a validation error
 *  (`loom.criterion-retrieval-name-clash`), so on a valid model the two sets
 *  are disjoint; excluding retrieval names here only keeps an erroring model
 *  lowering on its retrieval meaning. */
export type CriterionRunPredicate = (name: string) => boolean;

/** Build a {@link CriterionRunPredicate} from the enclosing context's members.
 *  Undefined ctx (a system-level `test e2e` block) → never a criterion, so
 *  `run` keeps its retrieval-only meaning there. */
export function runCriterionMatcher(ctx: BoundedContext | undefined): CriterionRunPredicate {
  if (!ctx) return () => false;
  const criteria = new Set<string>();
  const retrievals = new Set<string>();
  for (const m of ctx.members) {
    if (isCriterion(m)) criteria.add(m.name);
    else if (isRetrieval(m)) retrievals.add(m.name);
  }
  return (name) => criteria.has(name) && !retrievals.has(name);
}

export interface RepoMatch {
  repo: Repository;
  method: string;
  args: Expression[];
}

/** Recognise `<Repo>.<method>(args)` — a generic named repository call (a
 *  declared `find`, or the built-in `getById`).  Exactly one `MemberSuffix`
 *  with a call payload whose head names a repository.  Repo finds are
 *  positional, so the CallArg wrappers are peeled to bare value expressions. */
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
    method: s.member,
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
    declaredKeyTuples(repo.aggregate?.ref),
  );
  const own = callArgs.map((a, i) => a.name ?? `arg${i}`);
  const columns = res.kind === "match" ? [...res.tuple] : own;
  const byName = new Map(callArgs.map((a, i) => [own[i]!, a.value]));
  const args = columns.flatMap((col) => {
    const v = byName.get(col);
    return v ? [v] : [];
  });
  const bypass: { bypassAll?: boolean; bypassCaps?: string[] } = expr.bypassAll
    ? { bypassAll: true }
    : expr.bypass.length > 0
      ? { bypassCaps: [...expr.bypass] }
      : {};
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
}

/** Recognise `<Repo>.find(<CriterionRef>)` — the single-result sibling of
 *  `findAll` (criterion.md, use site 3).  No `page:` (a single result isn't
 *  paginated); the only arg is a criterion reference (bare `Name` or
 *  `Name(args)`).  Declines (→ `undefined`) on any other shape. */
export function matchFindCall(
  expr: Expression | undefined,
  reposByName: Map<string, Repository>,
): FindMatch | undefined {
  if (!expr || !isPostfixChain(expr) || expr.suffixes.length !== 1) return undefined;
  const s = expr.suffixes[0]!;
  if (!isMemberSuffix(s) || !s.call || s.member !== "find") return undefined;
  const recv = expr.head;
  if (!isNameRef(recv)) return undefined;
  const repo = reposByName.get(recv.name);
  if (!repo) return undefined;
  const refArg = (s.args ?? []).find((a) => !a.name);
  if (!refArg) return undefined;
  const critRef = criterionRefFromExpr(refArg.value);
  if (!critRef) return undefined;
  return { repo, criterionName: critRef.name, criterionArgs: critRef.args };
}

/** Recognise `<Repo>.<find>(args)` where `<find>` is a DECLARED find whose
 *  return type is optional (`find byCode(c: string): Order?`) — the second
 *  `if let` source form beside `Repo.find(<Criterion>)`.  A built-in verb
 *  (`getById` / `findById` / `findAll`) or a find declared non-optional,
 *  array-valued or union-valued declines: only a declared nullable find is
 *  emitted under its own name, returning the aggregate or absence, on every
 *  backend. */
export function matchOptionalFindCall(
  expr: Expression | undefined,
  reposByName: Map<string, Repository>,
  env?: Env,
): RepoMatch | undefined {
  const call = matchRepoCall(expr, reposByName);
  if (!call) return undefined;
  const decl = call.repo.finds.find((f) => f.name === call.method);
  if (!decl) return undefined;
  return lowerType(decl.returnType, env).kind === "optional" ? call : undefined;
}

export interface FindAllMatch {
  repo: Repository;
  /** The referenced criterion name. */
  criterionName: string;
  /** Lowered-later argument expressions of `Criterion(args)`. */
  criterionArgs: Expression[];
  pageOffset?: Expression;
  pageLimit?: Expression;
}

/** Recognise `<Repo>.findAll(<CriterionRef>, page?)` (criterion.md, use
 *  site 3).  The first positional arg is a criterion reference — a bare
 *  `Name` (parameterless) or `Name(args)` — and an optional named `page:`
 *  arg carries `{ offset?, limit? }`.  Structurally the mirror of
 *  `matchRetrievalRunCall`; only the method name (`findAll`) and the ref's
 *  meaning (criterion, not retrieval) differ. */
export function matchFindAllCall(
  expr: Expression | undefined,
  reposByName: Map<string, Repository>,
): FindAllMatch | undefined {
  if (!expr || !isPostfixChain(expr)) return undefined;
  if (expr.suffixes.length !== 1) return undefined;
  const s = expr.suffixes[0]!;
  if (!isMemberSuffix(s) || !s.call || s.member !== "findAll") return undefined;
  const recv = expr.head;
  if (!isNameRef(recv)) return undefined;
  const repo = reposByName.get(recv.name);
  if (!repo) return undefined;
  const callArgs = s.args ?? [];
  const refArg = callArgs.find((a) => !a.name);
  if (!refArg) return undefined;
  const ref = refArg.value;
  let criterionName: string;
  let criterionArgs: Expression[] = [];
  if (isNameRef(ref)) {
    criterionName = ref.name;
  } else if (isPostfixChain(ref) && isNameRef(ref.head) && ref.suffixes.length === 1) {
    const rs = ref.suffixes[0]!;
    if (!isCallSuffix(rs)) return undefined;
    criterionName = ref.head.name;
    criterionArgs = (rs.args ?? []).map((a) => a.value);
  } else {
    return undefined;
  }
  const pageArg = callArgs.find((a) => a.name === "page");
  let pageOffset: Expression | undefined;
  let pageLimit: Expression | undefined;
  if (pageArg && isObjectLit(pageArg.value)) {
    for (const f of pageArg.value.fields) {
      if (f.name === "offset") pageOffset = f.value;
      else if (f.name === "limit") pageLimit = f.value;
    }
  }
  return { repo, criterionName, criterionArgs, pageOffset, pageLimit };
}

export interface RetrievalRunMatch {
  repo: Repository;
  retrievalName: string;
  retrievalArgs: Expression[];
  /** Set when the run target was an anonymous retrieval literal
   *  (`retrieval { where: <Criterion> sort: … loads: … }`) rather than a named
   *  retrieval reference.  Lowers to a `synthCriterion` repo-run + shaping,
   *  riding the same enrich path as `findAll`. */
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

/** Recognise `<Repo>.run(<RetrievalRef>(args), page?)`.  The first
 *  positional arg is itself a call (the retrieval reference); an optional
 *  named `page:` arg carries an object literal `{ offset?, limit? }`.
 *
 *  When `isCriterionRun` classifies the bare-name / `Name(args)` target as a
 *  **criterion** (read-path-architecture.md, "`run` takes a criterion"), the
 *  match rides the SAME `anon` synthetic-criterion path as `findAll` /
 *  `run(retrieval { where })` — it desugars to `findAllBy<Criterion>` — so a
 *  criterion passed to `run` is first-class without a new IR shape. */
export function matchRetrievalRunCall(
  expr: Expression | undefined,
  reposByName: Map<string, Repository>,
  isCriterionRun?: CriterionRunPredicate,
): RetrievalRunMatch | undefined {
  if (!expr || !isPostfixChain(expr)) return undefined;
  if (expr.suffixes.length !== 1) return undefined;
  const s = expr.suffixes[0]!;
  if (!isMemberSuffix(s) || !s.call || s.member !== "run") return undefined;
  const recv = expr.head;
  if (!isNameRef(recv)) return undefined;
  const repo = reposByName.get(recv.name);
  if (!repo) return undefined;
  const callArgs = s.args ?? [];
  // First positional arg = the retrieval reference `Name(args)`.
  const refArg = callArgs.find((a) => !a.name);
  if (!refArg) return undefined;
  const ref = refArg.value;
  // `page:` is shared by the named and anonymous forms.
  const readPage = (): { pageOffset?: Expression; pageLimit?: Expression } => {
    const pageArg = callArgs.find((a) => a.name === "page");
    const out: { pageOffset?: Expression; pageLimit?: Expression } = {};
    if (pageArg && isObjectLit(pageArg.value)) {
      for (const f of pageArg.value.fields) {
        if (f.name === "offset") out.pageOffset = f.value;
        else if (f.name === "limit") out.pageLimit = f.value;
      }
    }
    return out;
  };
  // Anonymous retrieval literal — `run(retrieval { where: <Criterion> sort: …
  // loads: … })`.  The `where` must be a criterion reference (this release);
  // a non-criterion `where` is rejected by the language validator, so a miss
  // here just declines the match.
  if (isRetrievalLiteral(ref)) {
    const critRef = criterionRefFromExpr(ref.where);
    if (!critRef) return undefined;
    return {
      repo,
      retrievalName: "",
      retrievalArgs: [],
      anon: {
        criterionName: critRef.name,
        criterionArgs: critRef.args,
        sort: ref.sort,
        loads: ref.loads,
      },
      ...readPage(),
    };
  }
  // Bare `Name` (parameterless retrieval OR criterion) — still honours a
  // sibling `page:` arg (`Repo.run(Recent, page: { limit: 20 })`), like the
  // anonymous and `Name(args)` branches.
  if (isNameRef(ref)) {
    if (isCriterionRun?.(ref.name)) {
      return {
        repo,
        retrievalName: "",
        retrievalArgs: [],
        anon: { criterionName: ref.name, criterionArgs: [], sort: [], loads: [] },
        ...readPage(),
      };
    }
    return { repo, retrievalName: ref.name, retrievalArgs: [], ...readPage() };
  }
  // `Name(args)` — a NameRef head + a single CallSuffix.
  if (!isPostfixChain(ref) || !isNameRef(ref.head) || ref.suffixes.length !== 1) {
    return undefined;
  }
  const rs = ref.suffixes[0]!;
  if (!isCallSuffix(rs)) return undefined;
  const targetName = ref.head.name;
  const targetArgs: Expression[] = (rs.args ?? []).map((a) => a.value);
  // A criterion target (`run(InRegion("EU"))`) rides the synthetic-criterion
  // path, exactly like `findAll(InRegion("EU"))`.
  if (isCriterionRun?.(targetName)) {
    return {
      repo,
      retrievalName: "",
      retrievalArgs: [],
      anon: { criterionName: targetName, criterionArgs: targetArgs, sort: [], loads: [] },
      ...readPage(),
    };
  }
  return { repo, retrievalName: targetName, retrievalArgs: targetArgs, ...readPage() };
}

/** A criterion reference expression — a bare `Name` (parameterless) or
 *  `Name(args)`.  Shared by the `findAll` arg and the anonymous-retrieval
 *  `where:`. */
export function criterionRefFromExpr(
  ref: Expression,
): { name: string; args: Expression[] } | undefined {
  if (isNameRef(ref)) return { name: ref.name, args: [] };
  if (isPostfixChain(ref) && isNameRef(ref.head) && ref.suffixes.length === 1) {
    const rs = ref.suffixes[0]!;
    if (!isCallSuffix(rs)) return undefined;
    return { name: ref.head.name, args: (rs.args ?? []).map((a) => a.value) };
  }
  return undefined;
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
  /** For a criterion `find`/`findAll` — the referenced criterion name.  The
   *  read FILTERS by this criterion; without carrying it the criterion is
   *  silently dropped and the read returns every row (data-exposure).  Drives
   *  the synthesis of the `findAllBy<Criterion>` retrieval the backend renders. */
  criterionName?: string;
  /** For `run` — the referenced (named) retrieval.  Empty for an anonymous
   *  retrieval literal, whose predicate rides `criterionName` instead. */
  retrievalName?: string;
  /** For a natural-key read — the tuple and `ignoring` stance `method`
   *  names. */
  key?: KeyLookupIR;
}

/** Recognise ANY repository read in an expression position, collapsing the four
 *  read shapes to one `RepoReadMatch` for the domain-service `reading` tier.
 *  Tries the specific forms (`find` / `findAll` / `run`) before the generic
 *  named-find/`getById` form, mirroring the precedence the workflow let-lowerer
 *  uses (run → findAll → repo-call).  Returns `undefined` for a non-read (a
 *  WRITE like `save`/`insert` falls through here — it is NOT a read, so the
 *  validator's repo-WRITE gate rejects it). */
export function matchRepoRead(
  expr: Expression | undefined,
  reposByName: Map<string, Repository>,
  isCriterionRun?: CriterionRunPredicate,
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
  const find = matchFindCall(expr, reposByName);
  if (find)
    return {
      op: "select-one",
      repo: find.repo,
      method: "find",
      args: find.criterionArgs,
      criterionName: find.criterionName,
    };
  const findAll = matchFindAllCall(expr, reposByName);
  if (findAll)
    return {
      op: "select-many",
      repo: findAll.repo,
      method: "findAll",
      args: findAll.criterionArgs,
      criterionName: findAll.criterionName,
    };
  const run = matchRetrievalRunCall(expr, reposByName, isCriterionRun);
  if (run)
    return {
      op: "select-many",
      repo: run.repo,
      method: "run",
      args: run.anon ? run.anon.criterionArgs : run.retrievalArgs,
      ...(run.anon
        ? { criterionName: run.anon.criterionName }
        : { retrievalName: run.retrievalName }),
    };
  const repo = matchRepoCall(expr, reposByName);
  if (repo && !isRepoWriteName(repo.method)) {
    // A read name that is neither a declared find nor a contract verb rides
    // `declared-find`: it is resolved by name, and its validator reports the
    // unknown method.
    const declared = repo.repo.finds.some((f) => f.name === repo.method);
    const op = namedRepoCallOp(repo.method, declared) ?? "declared-find";
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
 *  repo read in a `domainService` body was typed by `inferExprType`, whose
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
 *  returns: `findAll` / `run` mirror its `repo-run` arms' `arrayType`, `named`
 *  mirrors its `repo-let` arm (a declared `returnType`, else the built-in's own
 *  shape), and `find` takes the `T?` its `if let` arm implies. */
export function repoReadResultType(read: RepoReadMatch, env?: Env): TypeIR {
  const entity: TypeIR = { kind: "entity", name: read.repo.aggregate?.ref?.name ?? "Unknown" };
  // A DECLARED find is the repository's own contract, so it wins and is
  // honoured verbatim (`Owner[]`, `Owner?`, a union…).
  if (read.op === "declared-find") {
    const decl = read.repo.finds.find((f) => f.name === read.method);
    // An unresolvable named read falls back to the bare aggregate, like the
    // workflow `repo-let` arm.
    return decl ? lowerType(decl.returnType, env) : entity;
  }
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
function repoResultTypeIR(op: Exclude<RepoOp, "declared-find">, entity: TypeIR): TypeIR {
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

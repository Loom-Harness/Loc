// Which bindings a workflow body defines, reads after a point, carries into a
// nested body, and changes inside one.
//
// A workflow body is imperative: `let`, `field := v`, operation calls that
// change a loaded aggregate in memory, and branches and loops around them.  A
// backend whose locals are immutable (Elixir; F# on the frontend) must thread
// every binding a nested construct changes back out of it, and only the ones
// something reads later; every backend that rejects an unused local binds
// only what is read.  Those are questions about the body, not about the
// target, so they are answered once here and each backend renders the answer:
// a functional target threads, an imperative one ignores the threading facts
// and drops or underscores unread bindings.
//
// "Read" means `namesUsed`: a `ref` read at any depth, or an operation call's
// receiver.  A save is not a read; callers that keep a binding alive for a
// save pass the saved names themselves (`liveLetNames` does the same for the
// exit and per-branch saves).

import type { ExprIR, WorkflowStmtIR } from "../types/loom-ir.js";
import { walkWorkflowStmtsDeep } from "../util/walk.js";
import { namesBound, namesUsed } from "./workflow-names.js";
import { nestedSaveScopes } from "./workflow-saves.js";

const NONE: ReadonlySet<string> = new Set();

/** The names something after a statement reads: the statements after it in
 *  its body (`rest`) and the expressions its enclosing construct evaluates
 *  after the body (`trailing`, such as a create's result value). */
export function readAfter(
  rest: readonly WorkflowStmtIR[],
  trailing: readonly (ExprIR | undefined)[] = [],
): Set<string> {
  return namesUsed(rest, trailing);
}

/** True when `name` is read after the statement whose followers are `rest`. */
export function isReadAfter(
  name: string,
  rest: readonly WorkflowStmtIR[],
  trailing: readonly (ExprIR | undefined)[] = [],
): boolean {
  return readAfter(rest, trailing).has(name);
}

/** The names a nested body reads that are bound outside it, plus `outer`
 *  (the names the enclosing body already carries, for a body nested in a
 *  loop).  `locals` are bound by the construct itself (a `for` variable, an
 *  `if let` binding, a `match` arm's binding) and so are not carried in. */
export function carriedInto(
  body: readonly WorkflowStmtIR[],
  locals: readonly string[] = [],
  outer: ReadonlySet<string> = NONE,
): Set<string> {
  const local = new Set([...locals, ...namesBound([body])]);
  return new Set([...outer, ...[...namesUsed(body)].filter((n) => !local.has(n))]);
}

/** The names whose value `bodies` change in place: every operation call's
 *  receiver, at any depth.  An operation changes the aggregate it is called
 *  on, so a backend with immutable locals rebinds the receiver. */
export function changedIn(bodies: readonly (readonly WorkflowStmtIR[])[]): Set<string> {
  const out = new Set<string>();
  for (const body of bodies) {
    for (const top of body) {
      walkWorkflowStmtsDeep(top, (s) => {
        if (s.kind === "op-call") out.add(s.target);
      });
    }
  }
  return out;
}

/** True when `bodies` assign one of the workflow's own state fields
 *  (`field := v`), at any depth. */
export function assignsOwnState(bodies: readonly (readonly WorkflowStmtIR[])[]): boolean {
  let found = false;
  for (const body of bodies) {
    for (const top of body) {
      walkWorkflowStmtsDeep(top, (s) => {
        if (s.kind === "assign") found = true;
      });
    }
  }
  return found;
}

/** What a nesting statement (`for`, `if`, `if let`, `match`) hands back to
 *  the body around it. */
export interface ThreadedOut {
  /** Outer bindings the construct changes, in first-read order: what a
   *  backend with immutable locals carries through and out of it. */
  readonly threaded: readonly string[];
  /** The subset of `threaded` something after the construct needs: a later
   *  read, the enclosing body's own carry, or a save. */
  readonly kept: readonly string[];
  /** True when the construct assigns the workflow's own state, which then
   *  has to come out of it too. */
  readonly ownState: boolean;
}

/** What `st` hands back to the body around it.  `after` describes that body
 *  past `st`: the statements that follow (`rest`), the expressions evaluated
 *  after it (`trailing`), the names the enclosing body itself carries
 *  (`carried`), and the names saved later (`saved`).  Empty for a statement
 *  that nests no body. */
export function threadedOut(
  st: WorkflowStmtIR,
  after: {
    readonly rest: readonly WorkflowStmtIR[];
    readonly trailing?: readonly (ExprIR | undefined)[];
    readonly carried?: ReadonlySet<string>;
    readonly saved?: ReadonlySet<string>;
  },
): ThreadedOut {
  const scopes = nestedSaveScopes(st);
  if (scopes.length === 0) return { threaded: [], kept: [], ownState: false };
  const bodies = scopes.map((s) => s.body);
  const locals = constructLocals(st);
  const carried = new Set(bodies.flatMap((b) => [...carriedInto(b, locals)]));
  const changed = changedIn(bodies);
  const threaded = [...carried].filter((n) => changed.has(n));
  const later = readAfter(after.rest, after.trailing ?? []);
  const kept = threaded.filter(
    (n) => later.has(n) || !!after.carried?.has(n) || !!after.saved?.has(n),
  );
  return { threaded, kept, ownState: assignsOwnState(bodies) };
}

/** The names a nesting statement binds for its own bodies only. */
function constructLocals(st: WorkflowStmtIR): string[] {
  switch (st.kind) {
    case "for-each":
    case "if-let":
      return [st.var];
    case "variant-match":
      return st.arms.flatMap((a) => (a.binding ? [a.binding] : []));
    case "if":
    case "precondition":
    case "requires":
    case "emit":
    case "factory-let":
    case "repo-let":
    case "expr-let":
    case "assign":
    case "repo-run":
    case "op-call":
    case "repo-delete":
    case "resource-call":
    case "domain-service-call":
    case "not-found":
      return [];
    default: {
      const _exhaustive: never = st;
      return _exhaustive;
    }
  }
}

/** The bindings a body defines that nothing reads or saves: a pure
 *  existence check, whose load still runs but whose name a backend that
 *  rejects an unused local must not bind. */
export function unreadBindings(
  statements: readonly WorkflowStmtIR[],
  saved: readonly { name: string }[] = [],
): string[] {
  const used = namesUsed(statements);
  for (const s of saved) used.add(s.name);
  for (const top of statements) {
    walkWorkflowStmtsDeep(top, (n) => {
      for (const scope of nestedSaveScopes(n)) for (const s of scope.saves) used.add(s.name);
    });
  }
  return namesBound([statements]).filter((n) => !used.has(n));
}

// Per-list page/sort state for the Feliz frontend.
//
// The scaffold gives every list page its own `state { pageNum, sortKey, sortDir }`
// controlling its server-paged read.  The Elmish program folds every page's state
// into ONE flat Model keyed by name, so N list pages would collapse onto a single
// `PageNum` / `SortKey` / `SortDir`: paging one list would move every other, and
// the shared `Set<Field>` arm could refetch only one of them.
//
// `scopeListState` gives each such page its own cells BEFORE anything is emitted,
// by renaming them in the page (state declaration, body, derived, actions) to
// `<page><Name>` (`providerListPageNum`).  Everything downstream — Model field,
// `Set<Field>` Msg, refetch arm, view reads — then derives from the renamed IR, so
// there is no second naming scheme to keep in step.  Cells that do not collide
// keep their names, so a one-list app is unchanged.

import type { ExprIR, PageIR, StmtIR, UiIR } from "../../ir/types/loom-ir.js";
import { mapExprChildren, mapStmtChildExprs, walkExprDeep } from "../../ir/util/walk.js";
import { lowerFirst, upperFirst } from "../../util/naming.js";
import { ofArgOf } from "../_walker/of-reads.js";

/** The page's state cells that drive a server-paged read: the `pageNum`,
 *  `sortKey` and `sortDir` refs of an `of: <Agg>.all(pageNum, <size>, sortKey,
 *  sortDir)` argument (the scaffold's shape — the same one `wire.ts` reads the
 *  read's controls from). */
function pagedControlCells(page: PageIR): string[] {
  if (!page.body) return [];
  const stateNames = new Set(page.state.map((s) => s.name));
  const out = new Set<string>();
  walkExprDeep(page.body, (e) => {
    const of = ofArgOf(e);
    if (!of) return;
    walkExprDeep(of, (c) => {
      if ((c.kind !== "call" && c.kind !== "method-call") || c.args.length !== 4) return;
      const [pageArg, sizeArg, keyArg, dirArg] = c.args;
      if (sizeArg?.kind !== "literal" || sizeArg.lit !== "int") return;
      for (const a of [pageArg, keyArg, dirArg])
        if (a?.kind === "ref" && stateNames.has(a.name)) out.add(a.name);
    });
  });
  return [...out];
}

function renameExpr(e: ExprIR, names: ReadonlyMap<string, string>): ExprIR {
  if (e.kind === "ref") {
    const to = names.get(e.name);
    // A lambda / match binding of the same spelling is a different variable.
    if (to !== undefined && e.refKind !== "lambda" && e.refKind !== "match-binding") {
      return { ...e, name: to };
    }
    return e;
  }
  return mapExprChildren(e, (c) => renameExpr(c, names));
}

function renameStmt(s: StmtIR, names: ReadonlyMap<string, string>): StmtIR {
  const withExprs = mapStmtChildExprs(s, (c) => renameExpr(c, names));
  const path = (p: { segments: string[] }): { segments: string[] } => {
    const head = p.segments[0];
    const to = head === undefined ? undefined : names.get(head);
    return to === undefined ? p : { ...p, segments: [to, ...p.segments.slice(1)] };
  };
  switch (withExprs.kind) {
    case "assign":
    case "add":
    case "remove":
      return { ...withExprs, target: path(withExprs.target) };
    case "if":
      return {
        ...withExprs,
        thenBody: withExprs.thenBody.map((n) => renameStmt(n, names)),
        ...(withExprs.elseBody
          ? { elseBody: withExprs.elseBody.map((n) => renameStmt(n, names)) }
          : {}),
      };
    case "variant-match":
      return {
        ...withExprs,
        arms: withExprs.arms.map((a) => ({ ...a, body: a.body.map((n) => renameStmt(n, names)) })),
        ...(withExprs.elseBody
          ? { elseBody: withExprs.elseBody.map((n) => renameStmt(n, names)) }
          : {}),
      };
    case "precondition":
    case "requires":
    case "let":
    case "expression":
    case "return":
    case "emit":
    case "call":
      return withExprs;
    default: {
      const _exhaustive: never = withExprs;
      return _exhaustive;
    }
  }
}

function renamePage(page: PageIR, names: ReadonlyMap<string, string>): PageIR {
  const rw = (e: ExprIR): ExprIR => renameExpr(e, names);
  return {
    ...page,
    state: page.state.map((f) => ({
      ...f,
      name: names.get(f.name) ?? f.name,
      ...(f.init ? { init: rw(f.init) } : {}),
    })),
    ...(page.body ? { body: rw(page.body) } : {}),
    ...(page.title ? { title: rw(page.title) } : {}),
    derived: page.derived.map((d) => ({ ...d, expr: rw(d.expr) })),
    actions: page.actions.map((a) => ({ ...a, body: a.body.map((s) => renameStmt(s, names)) })),
  };
}

/** Give each page whose paged-read controls collide with another page's its own
 *  cells.  `pageStem` names the page (the aggregate-qualified emit name). */
export function scopeListState(ui: UiIR, pageStem: (page: PageIR) => string): UiIR {
  const controlsByPage = new Map<PageIR, string[]>();
  const holders = new Map<string, number>();
  for (const page of ui.pages) {
    const cells = pagedControlCells(page);
    if (cells.length === 0) continue;
    controlsByPage.set(page, cells);
    for (const c of cells) holders.set(c, (holders.get(c) ?? 0) + 1);
  }
  const collides = [...holders.values()].some((n) => n > 1);
  if (!collides) return ui;
  const pages = ui.pages.map((page) => {
    const cells = (controlsByPage.get(page) ?? []).filter((c) => (holders.get(c) ?? 0) > 1);
    if (cells.length === 0) return page;
    const taken = new Set(page.state.map((s) => s.name));
    const names = new Map<string, string>();
    for (const c of cells) {
      let to = `${lowerFirst(pageStem(page))}${upperFirst(c)}`;
      while (taken.has(to)) to = `${to}_`;
      taken.add(to);
      names.set(c, to);
    }
    return renamePage(page, names);
  });
  return { ...ui, pages };
}

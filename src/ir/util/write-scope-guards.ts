// The write-scope requirement of a workflow / handler body's mutations.
//
// An op route loads its row through the backend's write-scope load
// (`getById` / `GetByIdForWriteAsync` / `get_by_id_for_write` /
// `get_<agg>_for_write`), so a row outside the caller's write scope —
// `policy { deny write on X }` — answers 404 before anything changes.  A body can hold a row
// that no such load produced: one returned by `Repo.all(<criterion>)`, a find,
// a loop variable.  Every aggregate mutation carries the same requirement
// whatever loaded the row, so before a statement mutates or deletes a row it
// holds, the body re-loads that row through the write-scope load.  A row
// outside the scope answers the op route's 404 and fails the whole body, whose
// transaction rolls back; rows are never filtered out.
//
// The requirement is DERIVED from the body's effects (`ir/util/effects.ts`):
// each `mutate` of an aggregate held by a local, and each `delete` of one,
// whose aggregate carries a `writeScopeFilter`.  A row the body CREATED is
// exempt: it is not stored yet (the write-scope load would not find it), and
// creating it is no instance mutation of an existing row.

import { plural } from "../../util/naming.js";
import type { AggregateIR, RepositoryIR, WorkflowStmtIR } from "../types/loom-ir.js";
import { contextSaveResolver, type SaveResolver } from "./domain-service-tier.js";
import { bodyEffects } from "./effects.js";
import { walkWorkflowStmtsDeep } from "./walk.js";

/** A row a statement mutates or deletes that must first be re-loaded through
 *  its aggregate's write-scope load.  `name` is the local holding the row;
 *  `repoName` the repository the body saves that aggregate through (the last
 *  one declared for it, as the body's saves pick). */
export interface WriteScopeGuard {
  readonly name: string;
  readonly aggName: string;
  readonly repoName: string;
}

/** What {@link writeScopeGuards} needs to know about the enclosing body and
 *  context.  Build it once per body with {@link writeScopeContext}. */
export interface WriteScopeContext {
  /** Locals the body binds to an aggregate it constructs (`factory-let`). */
  readonly created: ReadonlySet<string>;
  readonly resolver: SaveResolver;
  /** Aggregates whose write scope is narrower than their read scope, each
   *  with the repository the body saves it through. */
  readonly narrowed: ReadonlyMap<string, string>;
}

/** The context shape {@link writeScopeContext} reads. */
export interface WriteScopeHost {
  readonly aggregates: readonly AggregateIR[];
  readonly repositories: readonly Pick<RepositoryIR, "name" | "aggregateName">[];
  readonly domainServices: Parameters<typeof contextSaveResolver>[0]["domainServices"];
}

/** The {@link WriteScopeContext} of one body in `ctx`. */
export function writeScopeContext(
  statements: readonly WorkflowStmtIR[],
  ctx: WriteScopeHost,
): WriteScopeContext {
  const created = new Set<string>();
  for (const root of statements) {
    walkWorkflowStmtsDeep(root, (s) => {
      if (s.kind === "factory-let") created.add(s.name);
    });
  }
  const repoFor = new Map<string, string>();
  for (const r of ctx.repositories) repoFor.set(r.aggregateName, r.name);
  const narrowed = new Map<string, string>();
  for (const a of ctx.aggregates) {
    if (a.writeScopeFilter !== undefined) {
      narrowed.set(a.name, repoFor.get(a.name) ?? plural(a.name));
    }
  }
  return { created, resolver: contextSaveResolver(ctx), narrowed };
}

/** The ref kinds a held row is named by: a `let` / loop variable, or a
 *  `match` arm's narrowed binding. */
const HELD_ROW: ReadonlySet<string> = new Set(["let", "match-binding"]);

/** The rows `st` itself mutates or deletes (not those of a nested `for` /
 *  `if let` / `match` body, which their own statements answer for) that must
 *  be re-loaded through the write-scope load first, in program order, each
 *  local once. */
export function writeScopeGuards(st: WorkflowStmtIR, cx: WriteScopeContext): WriteScopeGuard[] {
  if (cx.narrowed.size === 0) return [];
  const out: WriteScopeGuard[] = [];
  const seen = new Set<string>();
  const add = (name: string, aggName: string): void => {
    const repoName = cx.narrowed.get(aggName);
    if (name === "" || repoName === undefined || cx.created.has(name) || seen.has(name)) return;
    seen.add(name);
    out.push({ name, aggName, repoName });
  };
  for (const e of bodyEffects({ statements: [st], savesAtExit: [] }, cx.resolver)) {
    if (e.scope.length > 0) continue;
    if (e.kind === "mutate" && e.target.kind === "aggregate") {
      add(e.target.name, e.target.aggName);
    } else if (e.kind === "delete" && e.entity.kind === "ref" && HELD_ROW.has(e.entity.refKind)) {
      add(e.entity.name, e.aggName);
    }
  }
  return out;
}

/** Every guard anywhere in `statements` (nested bodies included), in program
 *  order — for an emitter that must know up front whether a body re-checks
 *  any write scope (to run it in one transaction, or to inject a repository
 *  or the principal). */
export function bodyWriteScopeGuards(
  statements: readonly WorkflowStmtIR[],
  cx: WriteScopeContext,
): WriteScopeGuard[] {
  if (cx.narrowed.size === 0) return [];
  const out: WriteScopeGuard[] = [];
  for (const root of statements) {
    walkWorkflowStmtsDeep(root, (s) => {
      out.push(...writeScopeGuards(s, cx));
    });
  }
  return out;
}

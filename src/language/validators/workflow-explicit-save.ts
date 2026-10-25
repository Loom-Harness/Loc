// An explicit `Repo.save(x)` (or insert / update / add / commit) statement in
// a workflow or handler body.
//
// A workflow `create` / `handle` / `on` body and a `commandHandler` /
// `queryHandler` body persist at their EXIT: every aggregate the body created,
// or loaded and mutated through one of its operations, is written once on the
// way out (a `for` iteration and an `if let` branch save at their own end).
// There is one way to persist, so a statement that names a persistence verb is
// refused here instead of being reinterpreted: the body's effects
// (`ir/types/effect-ir.ts`) have no statement-level `persist`, and lowering
// drops the refused statement.
//
// Phase ④ because the statement is still visible here, with its span; once
// lowered it has no IR form.  The zone is the one `stmt-placement.ts` decides
// (`zoneOf`), so a domain-service body — which has its own `reading`-tier rule
// for writes — is not this check's.

import { type AstNode, AstUtils, type ValidationAcceptor } from "langium";
import { diagMessage } from "../../diagnostics/messages.js";
import { repoVerbEffect } from "../../util/repository-contract.js";
import {
  type AssignOrCallStmt,
  isAssignOrCallStmt,
  isBoundedContext,
  isRepository,
  type Model,
} from "../generated/ast.js";
import { describeOwner, zoneOf } from "./stmt-placement.js";

/** True when `name` is a repository declared in the bounded context that
 *  encloses `node`. */
function isContextRepository(node: AstNode, name: string): boolean {
  const ctx = AstUtils.getContainerOfType(node, isBoundedContext);
  return !!ctx?.members.some((m) => isRepository(m) && m.name === name);
}

/** The `Repo.<persist verb>(…)` call a statement makes, if it is one. */
function explicitSave(stmt: AssignOrCallStmt): { repo: string; verb: string } | undefined {
  const lv = stmt.target;
  if (stmt.op || !lv.call || lv.thisRef || lv.tail.length !== 1) return undefined;
  const verb = lv.tail[0]!;
  if (repoVerbEffect(verb) !== "persist") return undefined;
  if (!isContextRepository(stmt, lv.head)) return undefined;
  return { repo: lv.head, verb };
}

export function checkWorkflowExplicitSave(model: Model, accept: ValidationAcceptor): void {
  for (const node of AstUtils.streamAllContents(model)) {
    if (!isAssignOrCallStmt(node)) continue;
    const save = explicitSave(node);
    if (!save || zoneOf(node) !== "workflow") continue;
    accept(
      "error",
      diagMessage("loom.workflow-explicit-save", {
        repo: save.repo,
        verb: save.verb,
        owner: describeOwner(node),
      }),
      { node, code: "loom.workflow-explicit-save" },
    );
  }
}

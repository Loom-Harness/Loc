// `label(…)` / `plural(…)` — the model-identity text intrinsics (i18n).
//
//   loom.model-text-unresolved     the path names no model element (or names a
//                                  type declared in several contexts without
//                                  qualifying it — `#ambiguous`)
//   loom.model-text-plural-member  `plural()` on a member, an enum or an error
//   loom.model-text-outside-ui     the call sits outside every page / component
//                                  body (domain code, a filter, a criterion)
//   loom.model-text-in-template    the call is a template hole or a `+` operand:
//                                  a placeholder carries data, never words
//
// Resolution is the shared `src/language/model-text.ts`, over every document of
// the workspace, so a cross-file `label(Task)` resolves exactly as lowering
// resolves it.

import { type AstNode, AstUtils, type ValidationAcceptor } from "langium";
import { diagMessage } from "../../diagnostics/messages.js";
import type { DddServices } from "../ddd-module.js";
import type { Model, ModelText } from "../generated/ast.js";
import { buildModelTextIndex, resolveModelText } from "../model-text.js";

/** The text of a call as the user wrote it, for messages. */
function spelled(node: ModelText): { call: string; path: string } {
  return { call: node.kind ?? "label", path: node.path.join(".") };
}

/** True when the call sits inside a `ui { … }` or a top-level `component`. */
function insideUi(node: AstNode): boolean {
  for (let n: AstNode | undefined = node.$container; n; n = n.$container) {
    if (n.$type === "Ui" || n.$type === "Component") return true;
  }
  return false;
}

/** True when the call (through any parentheses) is a template hole or an
 *  operand of a `+` chain. */
function insideTemplate(node: AstNode): boolean {
  let n: AstNode = node;
  while (n.$container?.$type === "ParenExpr") n = n.$container;
  const parent = n.$container;
  if (!parent) return false;
  if (parent.$type === "TemplateHole") return true;
  if (parent.$type === "BinaryChain") {
    return (parent as unknown as { ops: readonly string[] }).ops.includes("+");
  }
  return false;
}

export function checkModelText(
  model: Model,
  accept: ValidationAcceptor,
  services?: DddServices,
): void {
  const calls: ModelText[] = [];
  for (const node of AstUtils.streamAllContents(model)) {
    if (node.$type === "ModelText") calls.push(node as ModelText);
  }
  if (calls.length === 0) return;
  // Resolve against THIS document first, and reach into the rest of the
  // workspace only for a type it does not declare: a workspace may hold
  // unrelated projects, and their same-named types must not make a local
  // `label(Order)` ambiguous.
  const local = buildModelTextIndex([model]);
  let workspace: ReturnType<typeof buildModelTextIndex> | undefined;
  const workspaceIndex = () => {
    if (workspace) return workspace;
    const roots: AstNode[] = [model];
    for (const d of services?.shared.workspace.LangiumDocuments.all ?? []) {
      const root = d.parseResult?.value;
      if (root && root !== model) roots.push(root);
    }
    workspace = buildModelTextIndex(roots);
    return workspace;
  };
  for (const node of calls) {
    const s = spelled(node);
    if (!insideUi(node)) {
      accept("error", diagMessage("loom.model-text-outside-ui", { call: s.call }), {
        node,
        code: "loom.model-text-outside-ui",
      });
      continue;
    }
    if (insideTemplate(node)) {
      accept("error", diagMessage("loom.model-text-in-template", { call: s.call }), {
        node,
        code: "loom.model-text-in-template",
      });
    }
    const kind = node.kind ?? "label";
    const first = resolveModelText(kind, node.path, local);
    const r =
      !first.ok && first.reason === "unresolved"
        ? resolveModelText(kind, node.path, workspaceIndex())
        : first;
    if (r.ok) continue;
    if (r.reason === "plural-member") {
      accept("error", diagMessage("loom.model-text-plural-member", { path: s.path }), {
        node,
        code: "loom.model-text-plural-member",
      });
    } else if (r.reason === "ambiguous") {
      accept(
        "error",
        diagMessage("loom.model-text-unresolved#ambiguous", { call: s.call, path: s.path }),
        {
          node,
          code: "loom.model-text-unresolved",
        },
      );
    } else {
      accept("error", diagMessage("loom.model-text-unresolved", { call: s.call, path: s.path }), {
        node,
        code: "loom.model-text-unresolved",
      });
    }
  }
}

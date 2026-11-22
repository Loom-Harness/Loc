// `loom.reserved-type-name` — a domain type named like a name the generated
// code binds where no emitter can re-spell it.
//
// The emitters alias or qualify a framework or runtime name a domain type
// shares, so `aggregate Page` or `aggregate Request` builds.  What is left is
// a name the generated code binds on its own account: a TypeScript global the
// emitted code calls (`Promise`), a generated module an aggregate of the name
// would overwrite (`app/domain/errors.py` for `Errors`), a generated member a
// type of the name cannot hold (the .NET factory `Create`).  Two bindings of
// one simple name do not build, so the name is refused here, on every target
// alike, and the model stays portable across the backend matrix; nothing is
// renamed or escaped.  A context named `permissions` is refused under the same
// code for language ambiguity (`Ctx.permissions.x`).  The table and its
// completeness gates live in `src/util/reserved-type-names.ts`.

import type { ValidationAcceptor } from "langium";
import { diagMessage } from "../../diagnostics/messages.js";
import { reservedContextName, reservedTypeName } from "../../util/reserved-type-names.js";
import {
  isAggregate,
  isBoundedContext,
  isDomainService,
  isEntityPart,
  isEnumDecl,
  isEventDecl,
  isPayloadDecl,
  isValueObject,
  type Model,
} from "../generated/ast.js";
import { modelContents } from "./model-contents.js";

/** The declaration kinds that become a generated type, by the keyword that
 *  declares them (a payload reports its own `command` / `query` / … kind). */
function typeKeyword(node: unknown): string | undefined {
  if (isAggregate(node)) return "aggregate";
  if (isEntityPart(node)) return "entity";
  if (isValueObject(node)) return "valueobject";
  if (isEnumDecl(node)) return "enum";
  if (isEventDecl(node)) return "event";
  if (isPayloadDecl(node)) return node.kind;
  if (isDomainService(node)) return "domainService";
  return undefined;
}

export function checkReservedTypeNames(model: Model, accept: ValidationAcceptor): void {
  for (const node of modelContents(model)) {
    if (isBoundedContext(node)) {
      const ctx = reservedContextName(node.name);
      if (ctx) {
        accept(
          "error",
          diagMessage("loom.reserved-type-name#context", { name: node.name, reason: ctx.reason }),
          { node, property: "name", code: "loom.reserved-type-name" },
        );
      }
      continue;
    }
    const keyword = typeKeyword(node);
    if (keyword === undefined) continue;
    const name = (node as { name?: unknown }).name;
    if (typeof name !== "string") continue;
    const entry = reservedTypeName(name);
    if (!entry) continue;
    accept(
      "error",
      diagMessage("loom.reserved-type-name", {
        keyword,
        name,
        binders: entry.bindings.map((b) => `${b.binder} (${b.target})`).join(", "),
      }),
      { node, property: "name", code: "loom.reserved-type-name" },
    );
  }
}

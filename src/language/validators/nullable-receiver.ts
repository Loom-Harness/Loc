// A member of a `T?` value is refused unless the value is narrowed first.
//
// One rule for every member: a field read (`addr.city`), a scalar property
// (`note.length`), an intrinsic or collection-op call (`note.toUpper()`,
// `tags.count`), a value-object `equals`. Every backend emits a bare
// dereference for each of them, which the generated project's own compiler
// rejects (`this._note.length` on a `string | null` is TS18047) or which
// crashes at request time. The typing pass resolves the member through the
// optional level and narrows each chain prefix a guard names, so the receiver
// type a suffix sees is already the narrowed one; this check only reads it.
//
// Two kinds of read are not refused:
//   - a FIELD read in a `ui` / `component` body: the frontends spell it
//     null-safe (`p.budget?.amount`, `_frontend/optional-member.ts`), so a
//     detail page reads an optional value object's leaves without a guard;
//   - anything in a `test` body: a null there fails the test, which is what an
//     assertion over the value (`expect(p.office.line1).toBe(…)`) means.

import { type AstNode, AstUtils, type ValidationAcceptor } from "langium";
import { diagMessage } from "../../diagnostics/messages.js";
import {
  isComponent,
  isMemberSuffix,
  isPostfixChain,
  isTestBlock,
  isTestE2E,
  isUi,
  type MemberSuffix,
  type Model,
} from "../generated/ast.js";
import { typeToString } from "../type-system.js";
import { typingFor } from "../typing/shared.js";
import type { Ty } from "../typing/ty.js";

function inFrontend(node: AstNode): boolean {
  return (
    AstUtils.getContainerOfType(node, isUi) !== undefined ||
    AstUtils.getContainerOfType(node, isComponent) !== undefined
  );
}

function inTest(node: AstNode): boolean {
  return (
    AstUtils.getContainerOfType(node, isTestE2E) !== undefined ||
    AstUtils.getContainerOfType(node, isTestBlock) !== undefined
  );
}

function isDereference(recv: Ty & { kind: "optional" }, ms: MemberSuffix, frontend: boolean) {
  const inner = recv.inner.kind;
  const fieldRead = !ms.call && (inner === "record" || inner === "valueobject" || inner === "id");
  return !(frontend && fieldRead);
}

export function checkNullableReceivers(model: Model, accept: ValidationAcceptor): void {
  for (const chain of AstUtils.streamAllContents(model).filter(isPostfixChain)) {
    if (inTest(chain)) continue;
    const typing = typingFor(chain);
    const frontend = inFrontend(chain);
    let recv = typing.synthAt(chain.head);
    for (const suffix of chain.suffixes) {
      const own = typing.synthAt(suffix);
      if (
        recv?.kind === "optional" &&
        isMemberSuffix(suffix) &&
        isDereference(recv, suffix, frontend)
      ) {
        // A member that does not exist at all is reported by the member and
        // intrinsic checks; that outranks its receiver's nullability.
        if (own?.kind === "unknown" && own.cause === "unresolved-member") break;
        accept(
          "error",
          diagMessage("loom.nullable-receiver", {
            member: suffix.call ? `.${suffix.member}()` : `.${suffix.member}`,
            recv: typeToString(recv),
          }),
          { node: suffix, property: "member", code: "loom.nullable-receiver" },
        );
        break;
      }
      recv = own;
    }
  }
}

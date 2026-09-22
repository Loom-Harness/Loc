// ---------------------------------------------------------------------------
// Linker — identical to Langium's, minus one `console.warn`.
//
// `DefaultLinker.createLinkingError` warns on stderr when a reference is
// resolved before its document reaches `ComputedScopes`:
//
//     Attempted reference resolution before document reached ComputedScopes
//     state (file:///…/main.ddd).
//
// In a stock Langium language that IS a bug hint, which is why it is there.
// In Loom it is expected, and it is expected BY DESIGN: the macro expander
// (`src/macros/expander.ts`) runs as a `DocumentState.IndexedContent` hook —
// deliberately before scope computation, so the members it synthesises are
// in the tree the scope pass then walks.  Reading a macro argument's
// reference there is precisely "resolution before ComputedScopes", and any
// `.ddd` whose macro arguments do not all resolve prints the warning once per
// probe.  On the field-test corpus a single mistyped type (`str` for
// `string`) printed it three times ahead of the one real diagnostic.
//
// The warning is therefore noise about a decision this codebase already made,
// and it goes to stderr where it cannot be filtered by the caller.  The
// linking ERROR it accompanies is untouched — same message, same range, same
// diagnostic.  If early resolution ever does become a bug here, the failing
// reference still reports itself.
// ---------------------------------------------------------------------------

import {
  type AstNode,
  type AstNodeDescription,
  AstUtils,
  DefaultLinker,
  type LinkingError,
  type ReferenceInfo,
} from "langium";
import { nearestType, primitiveTypeNames } from "./type-catalogue.js";

/** The reference type every TYPE position resolves through.  `NamedDecl` is
 *  used in exactly two grammar rules, `NamedType` (`target=[NamedDecl:ID]`) and
 *  `IdType` (`target=[NamedDecl:ID] 'id'`), so an unresolved one is always a
 *  user writing a type that does not exist — never some other broken link. */
const TYPE_REFERENCE = "NamedDecl";

export class DddLinker extends DefaultLinker {
  protected override createLinkingError(
    refInfo: ReferenceInfo,
    targetDescription?: AstNodeDescription,
  ): LinkingError {
    const referenceType = this.reflection.getReferenceType(refInfo);
    const name = refInfo.reference.$refText;
    return {
      info: refInfo,
      message:
        referenceType === TYPE_REFERENCE
          ? unknownTypeMessage(name, refInfo.container)
          : `Could not resolve reference to ${referenceType} named '${name}'.`,
      targetDescription,
    };
  }
}

/** The message a TYPE position gets instead of Langium's internal one.
 *
 *  `length: duration` reported "Could not resolve reference to NamedDecl named
 *  'duration'." — which names an internal grammar type, does not say the
 *  position is a type at all, and offers nothing to try.  (`docs/language.md`
 *  does say "there is no duration field type on the wire"; the compiler did
 *  not.)  This says what kind of thing was expected, what exists, and — when
 *  the name is a near miss, the far more common case (`strng` for `string`) —
 *  which one was probably meant. */
function unknownTypeMessage(name: string, container: AstNode): string {
  // Declared types reachable from this document, so the hint can land on a
  // user's own `valueobject` / `enum` as readily as on a primitive.
  const declared = new Set<string>();
  const root = AstUtils.findRootNode(container);
  if (root) {
    for (const node of AstUtils.streamAllContents(root)) {
      const n = (node as { name?: unknown }).name;
      if (typeof n === "string" && n.length > 0) declared.add(n);
    }
  }
  const primitives = primitiveTypeNames();
  const hint = nearestType(name, [...primitives, ...declared]);
  return (
    `Unknown type '${name}'.${hint ? ` Did you mean '${hint}'?` : ""}  Field types are: ` +
    `${primitives.join(", ")} — or an enum / valueobject / event / payload declared in ` +
    `scope; a reference to another aggregate is spelled '<Aggregate> id'.`
  );
}

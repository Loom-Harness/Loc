// ---------------------------------------------------------------------------
// F# identifier escaping for names DERIVED from user model names.
//
// The Feliz emitter builds bindings by casing a declared name — a wire record's
// decoder is `lowerFirst(<Aggregate>)`, so `aggregate Member` produced
//
//     and member : Decoder<Member> =
//
// and `member` is an F# KEYWORD.  `dotnet fable` stopped at
// "Unexpected keyword 'member' in binding", so an ordinary domain noun
// silently broke the whole frontend build — from a `.ddd` that validates
// `0 error(s), 0 warning(s)`.
//
// The .NET backend has an honest gate for its own version of this collision
// (`loom.dotnet-name-collision`, raised when an operation's PascalCase member
// would hide a same-named type).  Feliz had neither a gate nor an escape, which
// is the worse of the three states.  F# has first-class escaping for exactly
// this — a double-backtick identifier is legal wherever a plain one is — so
// this ESCAPES rather than gates: `aggregate Member` keeps working.
//
// The list is F#'s reserved-keyword set (F# 4.1+ spec §3.4), including the
// words reserved for future use — it lives in the shared per-target table,
// `src/util/target-identifiers.ts`.
// ---------------------------------------------------------------------------

import { escapeTargetIdent, isReserved } from "../../util/target-identifiers.js";

/** True when `name` cannot be spelled as a bare F# identifier. */
export function isFsKeyword(name: string): boolean {
  return isReserved("fsharp", name);
}

/** `name`, escaped with double backticks when it collides with an F# keyword.
 *
 *  Apply it to every identifier DERIVED from a user model name; a name the
 *  emitter chose itself (`fileRefDecoder`) needs no escaping and is unchanged,
 *  so an existing model's output stays byte-identical. */
export function fsIdent(name: string): string {
  return escapeTargetIdent("fsharp", name);
}

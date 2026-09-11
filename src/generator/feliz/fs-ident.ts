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
// words reserved for future use, since the compiler rejects those too.
// ---------------------------------------------------------------------------

const FS_KEYWORDS: ReadonlySet<string> = new Set([
  "abstract",
  "and",
  "as",
  "assert",
  "base",
  "begin",
  "class",
  "default",
  "delegate",
  "do",
  "done",
  "downcast",
  "downto",
  "elif",
  "else",
  "end",
  "exception",
  "extern",
  "false",
  "finally",
  "fixed",
  "for",
  "fun",
  "function",
  "global",
  "if",
  "in",
  "inherit",
  "inline",
  "interface",
  "internal",
  "lazy",
  "let",
  "match",
  "member",
  "module",
  "mutable",
  "namespace",
  "new",
  "not",
  "null",
  "of",
  "open",
  "or",
  "override",
  "private",
  "public",
  "rec",
  "return",
  "select",
  "static",
  "struct",
  "then",
  "to",
  "true",
  "try",
  "type",
  "upcast",
  "use",
  "val",
  "void",
  "when",
  "while",
  "with",
  "yield",
  // Reserved for future use — the compiler rejects these as identifiers too.
  "atomic",
  "break",
  "checked",
  "component",
  "const",
  "constraint",
  "constructor",
  "continue",
  "eager",
  "event",
  "external",
  "fixed_",
  "functor",
  "include",
  "method",
  "mixin",
  "object",
  "parallel",
  "process",
  "protected",
  "pure",
  "sealed",
  "tailcall",
  "trait",
  "virtual",
  "volatile",
]);

/** True when `name` cannot be spelled as a bare F# identifier. */
export function isFsKeyword(name: string): boolean {
  return FS_KEYWORDS.has(name);
}

/** `name`, escaped with double backticks when it collides with an F# keyword.
 *
 *  Apply it to every identifier DERIVED from a user model name; a name the
 *  emitter chose itself (`fileRefDecoder`) needs no escaping and is unchanged,
 *  so an existing model's output stays byte-identical. */
export function fsIdent(name: string): string {
  return isFsKeyword(name) ? `\`\`${name}\`\`` : name;
}

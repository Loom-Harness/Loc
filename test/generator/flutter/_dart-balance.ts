// A bracket-balance check over emitted Dart — the cheapest stand-in for
// `flutter analyze` that a unit test can run.
//
// Why it earns its place: the Flutter form widgets are built as long
// single-line template strings (`fieldWidget`, `objectCellWidget`), and the one
// defect they actually produce is an off-by-one closing paren — a `)` too many
// or too few at the end of a nested `Expanded(Padding(InkWell(InputDecorator(…`
// chain.  Substring assertions cannot see it (every fragment they check is
// present), the generator is happy (it is just string concatenation), and
// `ddd parse` is clean — so the first thing that notices is the
// `generated-flutter-build` CI gate, a day later.  One bracket sweep over the
// whole emitted file catches the whole class in milliseconds.
//
// It is deliberately NOT a Dart parser: it strips `//` comments and
// single-quoted string literals (the only string form the emitters use, escapes
// included) and then matches `()`, `[]` and `{}`.

/** Strip `//` line comments and single-quoted string literals, so brackets
 *  inside them do not count. */
function stripCommentsAndStrings(src: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "'") {
      i++;
      while (i < src.length && src[i] !== "'") {
        if (src[i] === "\\") i++;
        i++;
      }
      i++;
      continue;
    }
    out.push(c);
    i++;
  }
  return out.join("");
}

/** `undefined` when the source's brackets balance; otherwise a message naming
 *  the offending line, for use as an assertion's failure text. */
export function dartBracketImbalance(src: string): string | undefined {
  const clean = stripCommentsAndStrings(src);
  const opener: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  const stack: { ch: string; line: number }[] = [];
  let line = 1;
  for (const ch of clean) {
    if (ch === "\n") {
      line++;
    } else if (ch === "(" || ch === "[" || ch === "{") {
      stack.push({ ch, line });
    } else if (ch === ")" || ch === "]" || ch === "}") {
      const top = stack.pop();
      if (!top) return `unmatched '${ch}' at line ${line}`;
      if (top.ch !== opener[ch]) {
        return `'${top.ch}' opened at line ${top.line} is closed by '${ch}' at line ${line}`;
      }
    }
  }
  const left = stack[0];
  return left ? `'${left.ch}' opened at line ${left.line} is never closed` : undefined;
}

// ---------------------------------------------------------------------------
// The CODE positions of a C# compilation unit — what a textual post-pass over
// emitted .NET source may rewrite.  String, verbatim, raw and character
// literals and comments are not code; the holes of an interpolated string
// are.  `csCodeMask` keeps the text's offsets (every non-code character
// becomes a space, newlines stay), so a match found in the mask is rewritten
// at the same offset in the source.
// ---------------------------------------------------------------------------

/** `src` with every character outside code replaced by a space. */
export function csCodeMask(src: string): string {
  const out = src.split("");
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  /** Scan code from `i` until an unmatched `}` (when `inHole`) or the end;
   *  returns the index of that `}` (or the length). */
  const code = (start: number, inHole: boolean): number => {
    let i = start;
    let depth = 0;
    while (i < src.length) {
      const c = src[i]!;
      const next = src[i + 1];
      if (c === "/" && next === "/") {
        const end = src.indexOf("\n", i);
        const stop = end < 0 ? src.length : end;
        blank(i, stop);
        i = stop;
      } else if (c === "/" && next === "*") {
        const end = src.indexOf("*/", i + 2);
        const stop = end < 0 ? src.length : end + 2;
        blank(i, stop);
        i = stop;
      } else if (c === "'") {
        let j = i + 1;
        while (j < src.length && src[j] !== "'") j += src[j] === "\\" ? 2 : 1;
        blank(i, j + 1);
        i = j + 1;
      } else if (
        c === '"' ||
        ((c === "$" || c === "@") && /^[$@]{0,2}"/.test(src.slice(i, i + 3)))
      ) {
        i = literal(i);
      } else if (c === "{") {
        depth++;
        i++;
      } else if (c === "}") {
        if (inHole && depth === 0) return i;
        depth--;
        i++;
      } else {
        i++;
      }
    }
    return i;
  };
  /** A string literal starting at `start` (its `$`/`@` prefix included);
   *  returns the index just past it. */
  const literal = (start: number): number => {
    let i = start;
    let interpolated = false;
    let verbatim = false;
    while (src[i] === "$" || src[i] === "@") {
      if (src[i] === "$") interpolated = true;
      else verbatim = true;
      i++;
    }
    if (src.startsWith('"""', i)) {
      // A raw string literal: holes are not scanned (the emitters write none).
      let q = i;
      while (src[q] === '"') q++;
      const quotes = src.slice(i, q);
      const end = src.indexOf(quotes, q);
      const stop = end < 0 ? src.length : end + quotes.length;
      blank(start, stop);
      return stop;
    }
    let j = i + 1;
    let from = start;
    while (j < src.length) {
      const c = src[j]!;
      if (!verbatim && c === "\\") {
        j += 2;
      } else if (c === '"') {
        if (verbatim && src[j + 1] === '"') {
          j += 2;
          continue;
        }
        blank(from, j + 1);
        return j + 1;
      } else if (interpolated && c === "{") {
        if (src[j + 1] === "{") {
          j += 2;
          continue;
        }
        blank(from, j + 1);
        const close = code(j + 1, true);
        from = close;
        j = close + 1;
      } else {
        j++;
      }
    }
    blank(from, src.length);
    return src.length;
  };
  code(0, false);
  return out.join("");
}

/** Rewrite each occurrence of `re` (global) that starts in CODE at or after
 *  `from`: `replace` returns the replacement, or `undefined` to keep it. */
export function rewriteCode(
  src: string,
  re: RegExp,
  replace: (groups: readonly (string | undefined)[]) => string | undefined,
  from = 0,
): string {
  const mask = csCodeMask(src);
  let out = "";
  let last = 0;
  re.lastIndex = from;
  for (let m = re.exec(mask); m !== null; m = re.exec(mask)) {
    const r = replace(m);
    if (r === undefined) continue;
    out += src.slice(last, m.index) + r;
    last = m.index + m[0].length;
  }
  return last === 0 ? src : out + src.slice(last);
}

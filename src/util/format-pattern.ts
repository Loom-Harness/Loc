// The fixed, locale-independent date pattern subset that `date.format(…)` and
// `datetime.format(…)` accept — one tokenizer, so every backend and frontend
// reads a pattern the same way and an unknown token is a compile error, never
// a runtime surprise.
//
//   yyyy  four-digit year          HH  two-digit hour (00–23)
//   MM    two-digit month (01–12)  mm  two-digit minute
//   dd    two-digit day (01–31)    ss  two-digit second
//
// Any other letter run is refused (`yy`, `M`, `EEE`, …).  Text inside single
// quotes is literal (`'T'`, `'week '`), and `''` is one literal quote.  Every
// other character (`-`, `/`, `:`, `.`, space, digits, …) is literal as written,
// except `"` and `\`, which are refused so a pattern stays one plain string
// literal on every target.  A `datetime` is formatted in UTC; a `date` has no
// time of day, so `HH` / `mm` / `ss` are refused on it.
//
// Pure data, zero dependencies: the validator, the docs and each target's
// leaf read it.

/** A calendar or clock field a pattern can print. */
export type FormatField = "year" | "month" | "day" | "hour" | "minute" | "second";

export type FormatToken =
  | { kind: "field"; field: FormatField; width: number }
  | { kind: "literal"; text: string };

const FIELD_RUNS: Readonly<Record<string, FormatField>> = {
  yyyy: "year",
  MM: "month",
  dd: "day",
  HH: "hour",
  mm: "minute",
  ss: "second",
};

/** The time-of-day fields — refused on a `date` receiver. */
export const TIME_FIELDS: ReadonlySet<FormatField> = new Set(["hour", "minute", "second"]);

export type FormatPatternResult =
  | { ok: true; tokens: FormatToken[] }
  | { ok: false; problem: string };

/** Tokenize a pattern, or say what is wrong with it. */
export function parseFormatPattern(pattern: string): FormatPatternResult {
  const tokens: FormatToken[] = [];
  const pushLiteral = (text: string): void => {
    const last = tokens[tokens.length - 1];
    if (last?.kind === "literal") last.text += text;
    else tokens.push({ kind: "literal", text });
  };
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i]!;
    if (c === '"' || c === "\\") {
      return { ok: false, problem: `the character ${JSON.stringify(c)} is not allowed` };
    }
    if (c === "'") {
      if (pattern[i + 1] === "'") {
        pushLiteral("'");
        i += 2;
        continue;
      }
      const close = pattern.indexOf("'", i + 1);
      if (close < 0) return { ok: false, problem: "a quoted literal is not closed" };
      let text = pattern.slice(i + 1, close);
      // `''` inside a quoted run is one literal quote.
      let end = close;
      while (pattern[end + 1] === "'") {
        const next = pattern.indexOf("'", end + 2);
        if (next < 0) return { ok: false, problem: "a quoted literal is not closed" };
        text += `'${pattern.slice(end + 2, next)}`;
        end = next;
      }
      if (/["\\]/.test(text)) {
        return { ok: false, problem: 'the characters `"` and `\\` are not allowed' };
      }
      pushLiteral(text);
      i = end + 1;
      continue;
    }
    if (/[A-Za-z]/.test(c)) {
      let j = i;
      while (pattern[j] === c) j++;
      const run = pattern.slice(i, j);
      const field = FIELD_RUNS[run];
      if (!field) {
        return {
          ok: false,
          problem: `'${run}' is not a pattern token (yyyy, MM, dd, HH, mm, ss; quote literal letters, as in 'T')`,
        };
      }
      tokens.push({ kind: "field", field, width: run.length });
      i = j;
      continue;
    }
    pushLiteral(c);
    i++;
  }
  return { ok: true, tokens };
}

/** Tokens of a pattern the validator already accepted — throws otherwise
 *  (a generator reaching an invalid pattern is a toolchain bug). */
export function formatTokens(pattern: string): FormatToken[] {
  const r = parseFormatPattern(pattern);
  if (!r.ok) throw new Error(`invalid format pattern ${JSON.stringify(pattern)}: ${r.problem}`);
  return r.tokens;
}

/** The pattern text of a rendered string-literal argument.  Patterns hold no
 *  `"` or `\` (the tokenizer refuses both), so a double-quoted literal (every
 *  target but Dart) is the pattern itself between the quotes, and Dart's
 *  single-quoted one differs only by escaping `'` and `$` with a backslash. */
export function patternFromRenderedLiteral(rendered: string): string {
  const t = rendered.trim();
  const q = t[0];
  if (t.length < 2 || (q !== '"' && q !== "'") || t[t.length - 1] !== q) {
    throw new Error(`format pattern must be a string literal, got ${rendered}`);
  }
  return t.slice(1, -1).replace(/\\(.)/g, "$1");
}

/** Where each field sits in the canonical ISO text `YYYY-MM-DDTHH:mm:ss` —
 *  the targets whose date and datetime values are (or render to) that text
 *  print a field as a fixed slice of it. */
export const ISO_SLICE: Readonly<Record<FormatField, readonly [number, number]>> = {
  year: [0, 4],
  month: [5, 7],
  day: [8, 10],
  hour: [11, 13],
  minute: [14, 16],
  second: [17, 19],
};

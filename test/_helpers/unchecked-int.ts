// Strips the RS-48 overflow guards a backend wraps round integer `+ - *` and
// unary `-`, so an emission test that is about something else (naming,
// mangling, persistence shape) keeps asserting the bare arithmetic it names.
// The guards themselves are pinned by test/generator/_expr/checked-int.test.ts.

/** Index of the paren closing the one at `open`, or -1. */
function closeOf(text: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const c = text[i] as string;
    if (quote !== null) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
    } else if (c === '"') quote = c;
    else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i;
  }
  return -1;
}

/** Split `a, b` at its one top-level comma. */
function splitTop(args: string): [string, string] {
  let depth = 0;
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) return [args.slice(0, i), args.slice(i + 2)];
  }
  return [args, ""];
}

const TS_OPEN =
  /\(\(__v: number\): number => \{ if \(__v < -?\d+ \|\| __v > \d+\) throw new DomainError\("Value out of range"\); return __v; \}\)\(/g;
const PY_OPEN = /check_int\(/g;
const CS_OPEN = /checked\(/g;
const JAVA_OPEN = /Math\.(add|subtract|multiply|negate)Exact\(/g;
const EX_OPEN = /\(case /g;
const EX_WHOLE = /^case (.*) do v when v >= -?\d+ and v <= \d+ -> v; _ -> raise\([^)]*\) end$/s;

function unwrapOnce(text: string): string {
  const hits: { start: number; end: number; repl: string }[] = [];
  const scan = (
    re: RegExp,
    build: (inner: string, m: RegExpExecArray) => string | null,
    outerOpen: boolean,
  ) => {
    for (const m of text.matchAll(re)) {
      const m0 = m as RegExpExecArray;
      const open = outerOpen ? m0.index : m0.index + m0[0].length - 1;
      const close = closeOf(text, open);
      if (close < 0) continue;
      const start = outerOpen ? m0.index : m0.index;
      const inner = text.slice(open + 1, close);
      const repl = build(inner, m0);
      if (repl !== null) hits.push({ start, end: close + 1, repl });
    }
  };
  scan(TS_OPEN, (inner) => inner, false);
  scan(PY_OPEN, (inner) => inner.replace(/, -?\d+, -?\d+$/, ""), false);
  scan(CS_OPEN, (inner) => inner, false);
  scan(
    JAVA_OPEN,
    (inner, m) => {
      if (m[1] === "negate") return `-${inner}`;
      const [l, r] = splitTop(inner);
      return `${l} ${{ add: "+", subtract: "-", multiply: "*" }[m[1] as string]} ${r}`;
    },
    false,
  );
  scan(
    EX_OPEN,
    (inner) => {
      const m = EX_WHOLE.exec(inner);
      return m ? (m[1] as string) : null;
    },
    true,
  );
  if (hits.length === 0) return text;
  // Innermost first: the hit that starts last cannot contain another hit.
  hits.sort((a, b) => b.start - a.start);
  const h = hits[0] as { start: number; end: number; repl: string };
  return text.slice(0, h.start) + h.repl + text.slice(h.end);
}

export function uncheckedInt(text: string): string {
  let cur = text;
  for (;;) {
    const next = unwrapOnce(cur);
    if (next === cur) return cur;
    cur = next;
  }
}

// ---------------------------------------------------------------------------
// CLDR ordinal plural categories as data, for a runtime that has no ordinal
// rules of its own.
//
// Dart's `package:intl` selects a `{n, selectordinal, …}` branch with the
// CARDINAL rules (`2` → `other`, so English renders "2th"), and ships no
// ordinal rules to call instead.  The generator, running on Node, has the
// real CLDR ordinal rules in `Intl.PluralRules({ type: "ordinal" })`, so it
// tabulates them for each locale the app ships and the runtime only looks a
// number up.
//
// Every CLDR ordinal rule reads the integer through `n % 10`, `n % 100`,
// `n % 1000` or an exact value below 1000, so past a short prefix the
// categories repeat with a period of 1, 10, 100 or 1000.  A table is that
// prefix plus one period: category(n) = prefix[n] below the prefix's length,
// else cycle[(n - prefix.length) % cycle.length].  English is a 100-long cycle
// with no prefix; Japanese a one-letter cycle.
// ---------------------------------------------------------------------------

/** One letter per CLDR category, so a table is a plain string. */
export const ORDINAL_CATEGORY_LETTERS: Readonly<Record<string, string>> = {
  zero: "z",
  one: "o",
  two: "t",
  few: "f",
  many: "m",
  other: "x",
};

/** A locale's ordinal categories as `prefix` + repeating `cycle`. */
export interface OrdinalTable {
  readonly prefix: string;
  readonly cycle: string;
}

const PERIODS = [1, 10, 100, 1000] as const;
/** How far the derived table is checked against the live rules. */
const VERIFY_UP_TO = 20_000;

/** The ordinal table for `locale`, or undefined when the runtime that
 *  generates the app has no rules for it (the app then selects `other`). */
export function ordinalTable(locale: string): OrdinalTable | undefined {
  if (Intl.PluralRules.supportedLocalesOf([locale]).length === 0) return undefined;
  const rules = new Intl.PluralRules(locale, { type: "ordinal" });
  const letters: string[] = [];
  for (let n = 0; n <= VERIFY_UP_TO; n++) {
    letters.push(ORDINAL_CATEGORY_LETTERS[rules.select(n)] ?? "x");
  }
  const all = letters.join("");
  let best: OrdinalTable | undefined;
  for (const period of PERIODS) {
    // The shortest prefix after which `all` repeats with this period.
    let start = VERIFY_UP_TO - period;
    while (start > 0 && all[start - 1] === all[start - 1 + period]) start -= 1;
    if (start + 2 * period > VERIFY_UP_TO) continue;
    const table = { prefix: all.slice(0, start), cycle: all.slice(start, start + period) };
    const size = table.prefix.length + table.cycle.length;
    if (!best || size < best.prefix.length + best.cycle.length) best = table;
  }
  if (!best) {
    throw new Error(`ordinal-rules: no periodic ordinal table for locale "${locale}"`);
  }
  return best;
}

/** The category letter a table assigns to the non-negative integer `n`. */
export function ordinalLetter(table: OrdinalTable, n: number): string {
  if (n < table.prefix.length) return table.prefix[n]!;
  return table.cycle[(n - table.prefix.length) % table.cycle.length]!;
}

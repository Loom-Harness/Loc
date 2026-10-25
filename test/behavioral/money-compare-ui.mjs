// The expectation half of `money-compare-ui.ddd` (#3263) — ONE table both
// behavioural UI runners read (`run-ui.mjs` over the DOM, `run-ui-flutter.mjs`
// over Flutter's accessibility tree), so the page and its probe cannot drift.
//
// Each comparison renders `<name>=yes` or `<name>=no`.  The probe requires the
// RIGHT token and refuses the WRONG one: a page that rendered nothing, or both,
// fails as surely as one that compared money by reference.

/** `name → expected answer`, as `.ddd`/Loom semantics define it. */
export const MONEY_COMPARE_EXPECT = {
  // 10 == 10.00 by value (a `Decimal` `===` said no).
  "money-eq": "yes",
  "money-ne": "no",
  // 9 < 10 by value (`valueOf()` strings said no).
  "money-lt": "yes",
  "money-ge": "yes",
  // A present `money?` against a plain `money`.
  "money-opt-eq": "yes",
  "money-opt-gt": "yes",
  // An absent `money?`: unequal, and every ordering is false.
  "money-absent-eq": "no",
  "money-absent-lt": "no",
  "money-absent-ge": "no",
  // Both absent: equal.
  "money-both-absent": "yes",
};

export const MONEY_COMPARE_ROUTE = "/money-compare";

/** Tokens the rendered page must contain. */
export const moneyCompareExpected = () =>
  Object.entries(MONEY_COMPARE_EXPECT).map(([k, v]) => `${k}=${v}`);

/** Tokens the rendered page must NOT contain (each comparison's wrong answer). */
export const moneyCompareForbidden = () =>
  Object.entries(MONEY_COMPARE_EXPECT).map(([k, v]) => `${k}=${v === "yes" ? "no" : "yes"}`);

/** Judge a rendered text: `[]` when every comparison answered right, else the
 *  list of problems (a missing right answer, or a present wrong one). */
export function judgeMoneyCompare(text) {
  const why = [];
  for (const t of moneyCompareExpected()) if (!text.includes(t)) why.push(`missing ${t}`);
  for (const t of moneyCompareForbidden()) if (text.includes(t)) why.push(`wrong answer ${t}`);
  return why;
}

// The expectation half of `sort-order-ui.ddd` — ONE table both behavioural UI
// runners read (`run-ui.mjs` over the DOM, `run-ui-flutter.mjs` over Flutter's
// accessibility tree), so the page and its probe cannot drift.
//
// Each sort renders `<name>=<the items joined by |>`.  The probe requires the
// RIGHT order and refuses the host-default orders a frontend could fall back
// to (UTF-16 order puts `😀` below `Ａ`; declaration order puts `Open` first).

/** `name → expected order`, as the one sort order defines it. */
export const SORT_ORDER_EXPECT = {
  "words-up": "B|Z|a|b|ä|é|Ａ|😀",
  "words-down": "😀|Ａ|é|ä|b|a|Z|B",
  "statuses-up": "Archived|Closed|Open",
};

/** The orders a frontend's host comparer would produce instead. */
const SORT_ORDER_WRONG = {
  "words-up": "B|Z|a|b|ä|é|😀|Ａ",
  "words-down": "Ａ|😀|é|ä|b|a|Z|B",
  "statuses-up": "Open|Closed|Archived",
};

export const SORT_ORDER_ROUTE = "/sort-order";

/** Tokens the rendered page must contain. */
export const sortOrderExpected = () =>
  Object.entries(SORT_ORDER_EXPECT).map(([k, v]) => `${k}=${v}`);

/** Judge a rendered text: `[]` when every sort answered right, else the list
 *  of problems (a missing right order, or a host-default order). */
export function judgeSortOrder(text) {
  const why = [];
  for (const t of sortOrderExpected()) if (!text.includes(t)) why.push(`missing ${t}`);
  for (const [k, v] of Object.entries(SORT_ORDER_WRONG)) {
    if (text.includes(`${k}=${v}`)) why.push(`host order ${k}=${v}`);
  }
  return why;
}

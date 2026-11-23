// The expectation half of `string-units-ui.ddd` — ONE table both behavioural
// UI runners read (`run-ui.mjs` over the DOM, `run-ui-flutter.mjs` over
// Flutter's accessibility tree), so the page and its probe cannot drift.
//
// Each op renders `<name>=<value>|` over `"a😀bc"` (4 code points, 5 UTF-16
// units).  The probe requires the code-point answer and refuses the UTF-16 one
// a frontend's host string primitive would produce.  `list-len` is the
// collection `.length`, which counts elements on both readings.

/** `name → expected value`, counted in code points as every backend counts. */
export const STRING_UNITS_EXPECT = {
  len: "4",
  sub: "😀b",
  tail: "bc",
  past: "",
  "pad-start": "--a😀bc",
  "pad-end": "a😀bc--",
  "list-len": "3",
};

/** The values a UTF-16-unit reading produces instead. */
const STRING_UNITS_WRONG = {
  len: "5",
  sub: "😀",
  tail: "\udE00bc",
  past: "c",
  "pad-start": "-a😀bc",
  "pad-end": "a😀bc-",
};

export const STRING_UNITS_ROUTE = "/string-units";

/** Tokens the rendered page must contain. */
export const stringUnitsExpected = () =>
  Object.entries(STRING_UNITS_EXPECT).map(([k, v]) => `${k}=${v}|`);

/** Judge a rendered text: `[]` when every op answered in code points, else the
 *  list of problems (a missing right answer, or a UTF-16 one). */
export function judgeStringUnits(text) {
  const why = [];
  for (const t of stringUnitsExpected()) if (!text.includes(t)) why.push(`missing ${t}`);
  for (const [k, v] of Object.entries(STRING_UNITS_WRONG)) {
    if (text.includes(`${k}=${v}|`)) why.push(`UTF-16 answer ${k}=${v}|`);
  }
  return why;
}

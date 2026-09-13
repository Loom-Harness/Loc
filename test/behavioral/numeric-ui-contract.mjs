// The ONE numeric wire contract the two SELF-HOSTING frontend legs are held to
// (M-T9.38) — Flutter (`run-ui-flutter.mjs`, accessibility tree) and Feliz
// (`run-ui.mjs` over the emitted `*.ui.spec.ts`, DOM).
//
// Why a shared module rather than literals in each leg: the legs assert a
// RENDERED value against a SEEDED one, so the seed and the expectation are two
// halves of one claim.  Held apart, they drift — and a drifted pair does not go
// red, it goes VACUOUS: the seed stops carrying the value the probe polls for,
// the probe's `expect` still matches something incidental on the page, and the
// leg keeps passing while proving nothing.  That is the failure shape this repo
// has now hit repeatedly (`experience_gathered.md` §59/§63: a gate that never
// reaches the thing it names).  `numeric-ui-legs.test.ts` asserts over this
// table in the FAST suite, so the nightly legs cannot quietly lose their
// subject.
//
// The four rows are four DIFFERENT wire spellings, which is the whole point —
// `money` crosses as a fixed-scale-4 STRING (RS-12) while `decimal` crosses as a
// JSON number (RS-24), and F1 (the numeric-types audit finding this mission was
// minted from) was a Dart decoder that treated the first as the second:
// `(json['listPrice'] as num)` compiles, analyzes clean, and throws on the first
// read.  Neither `flutter analyze`/`flutter build web` nor `dotnet fable` can see
// the difference; only a booted app can.

/** `long` stays BELOW 2^53 deliberately.  Past that boundary the semantics are
 *  undecided — M-T5.23 is `blocked(D-LONG-AVG-DEFAULTS)` — and a runtime leg must
 *  not encode an open ruling as a pass.  1234567890123456 is ~1.2e15 against the
 *  ~9.0e15 ceiling, and still far past 2^31, so an int32-width mistake fails. */
const BARCODE = 1234567890123456;

/**
 * One row per numeric host type.
 *
 * - `seed` is the value spelled the way the WIRE spells it, POSTed straight to
 *   `/api` by the flutter leg (its read half is where the contract lives) and
 *   typed through the real create FORM by the feliz leg.
 * - `flutter` / `feliz` are the MEASURED rendered texts, not predictions.  They
 *   differ on `money` on purpose and that divergence is itself a finding worth
 *   keeping visible: Flutter renders money through
 *   `NumberFormat.decimalPattern()`, which drops the scale ("98.76"), while the
 *   Feliz detail cell renders `string (decimal)` and keeps it ("98.7600").  Same
 *   value, same wire, two displays — recorded here rather than smoothed over, so
 *   whichever way it is later unified, this table is what has to change.
 */
export const NUMERIC_FIELDS = [
  { field: "listPrice", host: "money", wire: "string", seed: "98.7600", flutter: "98.76", feliz: "98.7600" },
  { field: "weight", host: "decimal", wire: "number", seed: 1.25, flutter: "1.25", feliz: "1.25" },
  { field: "stock", host: "int", wire: "number", seed: 4242, flutter: "4242", feliz: "4242" },
  { field: "barcode", host: "long", wire: "number", seed: BARCODE, flutter: String(BARCODE), feliz: String(BARCODE) },
];

/** The numeric half of the seeded product row, as a POST body fragment. */
export const numericSeedBody = () =>
  Object.fromEntries(NUMERIC_FIELDS.map((f) => [f.field, f.seed]));

/** What the Flutter app must have rendered into its accessible text.
 *
 *  Every entry is at least four characters — `stock: 7` would have rendered a
 *  bare "7", which `text.includes("7")` finds inside any UUID the same page
 *  prints.  An assertion that matches anything is not an assertion, so the
 *  DISCRIMINATING-ness of these values is part of the contract and is asserted
 *  in `numeric-ui-legs.test.ts`. */
export const flutterExpectations = () => NUMERIC_FIELDS.map((f) => f.flutter);

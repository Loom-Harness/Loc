/**
 * Hand-written types for the plain-node contract table beside this file, on the
 * `ci-budget-report.d.mts` pattern.
 *
 * `numeric-ui-contract.mjs` stays `.mjs` because `run-ui-flutter.mjs` — a script
 * run directly by `node`, with no build step — imports it. `numeric-ui-legs.test.ts`
 * imports the same module so the fast-suite ratchet asserts over the table the LEG
 * actually reads rather than a copy of it, and an untyped import weakens exactly
 * that: at `any`, a row missing `feliz` or a `seed` of the wrong kind type-checks.
 *
 * `tsconfig.test.json` includes only `test/**\/*.ts` and does not set `allowJs`, so a
 * sibling declaration file is what gives the import a real signature.
 */

/** One numeric host type, its wire spelling, and the text each target renders. */
export interface NumericField {
  /** The `Product` field name, in both fixtures. */
  field: string;
  /** The Loom host type — `money` | `decimal` | `int` | `long`. */
  host: string;
  /** How that host type crosses the wire: a JSON `string` or a JSON `number`. */
  wire: "string" | "number";
  /** The seeded value, spelled the way the wire spells it. */
  seed: string | number;
  /** MEASURED rendered text in the built Flutter app's accessible text. */
  flutter: string;
  /** MEASURED rendered text in the Feliz detail page's value cell. */
  feliz: string;
}

export declare const NUMERIC_FIELDS: readonly NumericField[];

/** The numeric half of the seeded product row, as a POST body fragment. */
export declare const numericSeedBody: () => Record<string, string | number>;

/** What the Flutter app must have rendered into its accessible text. */
export declare const flutterExpectations: () => string[];

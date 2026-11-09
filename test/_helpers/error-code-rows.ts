// ---------------------------------------------------------------------------
// Which backend answers every refusal with its catalog `code` (#4473).
//
// The ONE table the error-code parity harness
// (`test/system/error-code-parity.test.ts`) and the wire-differential waivers
// (`wire-waivers.ts`) both read.  A backend is either `done` — its emitted
// project carries `code` / `params` on every error path and declares them in
// its OpenAPI ProblemDetails schema — or `pending` on a named issue, in which
// case its booted wire legs are waived on exactly the `code` / `params`
// members and nothing else.
//
// Flipping a row to `done` is the whole fan-out step: the parity harness then
// asserts the backend's emitted output, and the waivers for its legs vanish,
// so the booted golden compare gates it too.  The harness FAILS a `pending`
// row whose backend already emits the codes (flip it), and a backend missing
// from the table.
//
// `fieldLimits` is the same switch for the declared-field-limit codes
// (`field.min` … `field.pattern`, `FIELD_LIMIT_REASONS` in
// `src/ir/enrich/wire-policy.ts`), which a backend answers by calling the
// shared `fieldLimitChecks` at its native-constraint site.  A backend whose
// `status` is `done` but whose `fieldLimits` is `pending` is gated on every
// other code, and waived on exactly a field-limit entry's `code` / `params`.
// ---------------------------------------------------------------------------

export type ErrorCodeStatus = "done" | { readonly pending: string };

export interface ErrorCodeRow {
  /** The `platform:` the backend is generated with. */
  readonly platform: "node" | "dotnet" | "python" | "java" | "elixir";
  /** The booted wire legs (`test/behavioral/run*.mjs`) that run this backend. */
  readonly wireLegs: readonly string[];
  readonly status: ErrorCodeStatus;
  /** Whether its native field constraints answer their own `field.<limit>`
   *  code with the bound in `params`, rather than the generic `field.rule`. */
  readonly fieldLimits: ErrorCodeStatus;
}

export const ERROR_CODE_ROWS: readonly ErrorCodeRow[] = [
  { platform: "node", wireLegs: ["node", "mikroorm"], status: "done", fieldLimits: "done" },
  { platform: "dotnet", wireLegs: ["dotnet", "dapper"], status: "done", fieldLimits: "done" },
  { platform: "python", wireLegs: ["python"], status: "done", fieldLimits: "done" },
  { platform: "java", wireLegs: ["java"], status: "done", fieldLimits: "done" },
  { platform: "elixir", wireLegs: ["elixir"], status: "done", fieldLimits: "done" },
];

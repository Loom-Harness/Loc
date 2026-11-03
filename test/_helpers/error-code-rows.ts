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
// ---------------------------------------------------------------------------

export type ErrorCodeStatus = "done" | { readonly pending: string };

export interface ErrorCodeRow {
  /** The `platform:` the backend is generated with. */
  readonly platform: "node" | "dotnet" | "python" | "java" | "elixir";
  /** The booted wire legs (`test/behavioral/run*.mjs`) that run this backend. */
  readonly wireLegs: readonly string[];
  readonly status: ErrorCodeStatus;
}

export const ERROR_CODE_ROWS: readonly ErrorCodeRow[] = [
  { platform: "node", wireLegs: ["node", "mikroorm"], status: "done" },
  { platform: "dotnet", wireLegs: ["dotnet", "dapper"], status: "done" },
  { platform: "python", wireLegs: ["python"], status: "done" },
  { platform: "java", wireLegs: ["java"], status: { pending: "#4473 fan-out" } },
  { platform: "elixir", wireLegs: ["elixir"], status: { pending: "#4473 fan-out" } },
];

/** The wire legs whose backend still answers without `code` / `params`. */
export function pendingErrorCodeLegs(): string[] {
  return ERROR_CODE_ROWS.filter((r) => r.status !== "done").flatMap((r) => r.wireLegs);
}

/** The shared runtime helpers an Elixir app's emitters CALL, recorded where
 *  the call is rendered.  One instance per generated app: a renderer that
 *  writes a helper call records it here, and the app emits the helper's
 *  definition iff it was recorded — never by searching the emitted text. */
export class ElixirHelperUses {
  /** `ProblemDetails.type_mismatches/2` — the strict-ingress plug
   *  (`renderStrictParamsPlug`) calls it. */
  typeMismatches = false;
}

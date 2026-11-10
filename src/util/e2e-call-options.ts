// The options argument of a `test e2e` write call (`{ ifMatch: <version> }`),
// shared by the IR reading (`src/ir/util/e2e-call-options.ts`) and the typing
// pass.

/** The one key the options object accepts. */
export const E2E_IF_MATCH_OPTION = "ifMatch";

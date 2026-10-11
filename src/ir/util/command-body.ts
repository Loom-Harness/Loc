// -------------------------------------------------------------------------
// Is a command's request body OPTIONAL in the published contract? (RS-39)
//
// Every backend reads an empty request body as `{}` — with no Content-Type or
// a JSON one.  So a command that declares no parameters (`operation
// confirm()`, a workflow started with no input) can be called with no body at
// all, and its OpenAPI `requestBody` says it is not required.  A command WITH parameters
// keeps its body required: an empty body there is the `{}` that fails its
// validation with 422, not an accepted call.
//
// One predicate, so the five specs cannot disagree about which routes publish
// an optional body.  Pure, platform-neutral, browser-safe.
// -------------------------------------------------------------------------

/** True when a command with these inputs publishes an optional request body. */
export function commandBodyOptional(inputs: readonly unknown[]): boolean {
  return inputs.length === 0;
}

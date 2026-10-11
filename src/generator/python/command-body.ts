import { commandBodyOptional } from "../../ir/util/command-body.js";

/** What a route body carries when it uses FastAPI's `Body` marker — the
 *  import gate for `from fastapi import Body`. */
const OPTIONAL_BODY_MARK = "Body(default_factory=";

/** The `body` parameter of a command route.  A command with no inputs takes
 *  its (empty) request model with a default (RS-43), so FastAPI publishes the
 *  request body as optional — the runtime half (an empty body read as `{}`) is
 *  `JsonBodyMiddleware`. */
export function pyCommandBodyParam(model: string, inputs: readonly unknown[]): string {
  return commandBodyOptional(inputs)
    ? `body: Annotated[${model}, ${OPTIONAL_BODY_MARK}${model})]`
    : `body: ${model}`;
}

/** True when emitted route source uses the optional-body marker. */
export function usesOptionalBody(source: string): boolean {
  return source.includes(OPTIONAL_BODY_MARK);
}

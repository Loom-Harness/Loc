import { commandBodyOptional } from "../../ir/util/command-body.js";
import { pyRef } from "../_imports/python.js";

const ANNOTATED = pyRef("typing", "Annotated");
const BODY = pyRef("fastapi", "Body");

/** The `body` parameter of a command route.  A command with no inputs takes
 *  its (empty) request model with a default (RS-39), so FastAPI publishes the
 *  request body as optional — the runtime half (an empty body read as `{}`) is
 *  `JsonBodyMiddleware`. */
export function pyCommandBodyParam(model: string, inputs: readonly unknown[]): string {
  return commandBodyOptional(inputs)
    ? `body: ${ANNOTATED}[${model}, ${BODY}(default_factory=${model})]`
    : `body: ${model}`;
}

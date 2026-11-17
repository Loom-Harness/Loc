// Which fields of an aggregate's create request a client MUST send: the rest
// are optional, defaulted, or a bare `bool` (`isRequiredCreateInput`).  What an
// OpenAPI document lists as `required` on the create request body.
//
// It reads the wire projection's input rule, so it lives apart from
// `create-request.ts`, which the frontends read and which reaches no build pass.

import { isRequiredCreateInput } from "../enrich/wire-projection.js";
import type { AggregateIR, PayloadIR } from "../types/loom-ir.js";
import { createRequestFields } from "./create-request.js";

/** The names of the create request's fields a client MUST send: the rest are
 *  optional, defaulted, or a bare `bool` (`isRequiredCreateInput`).  What an
 *  OpenAPI document lists as `required` on the create request body. */
export function createRequestRequiredNames(
  payloads: readonly PayloadIR[],
  agg: AggregateIR,
): string[] {
  return createRequestFields(payloads, agg)
    .filter(isRequiredCreateInput)
    .map((f) => f.name);
}

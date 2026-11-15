// What a client sends to create an aggregate: the declared create command
// record.
//
// Every frontend's create form, its request schema, its page object and its
// i18n chrome read this one fact, so a create form never asks for a field the
// create command does not take.  An event-sourced aggregate is the case where
// it matters most: its create command is its `create` action's params, while
// its declared fields are folded state the client never sends.
//
// An aggregate whose context declares no create record takes no create
// request: the scaffold splices a create record for every concrete aggregate
// of an exposed context, and every emitter renders a create request only for
// a served create.  `test/system/create-request-census.test.ts` holds every
// served creatable aggregate to a declared record.

import { isRequiredCreateInput } from "../enrich/wire-projection.js";
import type { AggregateIR, FieldIR, PayloadIR } from "../types/loom-ir.js";
import { declaredCreateCommandFor } from "../util/declared-request.js";

/** The declared command record an aggregate's create request is, when its
 *  context declares one. */
export function createRequestRecord(
  payloads: readonly PayloadIR[],
  agg: AggregateIR,
): PayloadIR | undefined {
  return declaredCreateCommandFor(payloads, agg);
}

/** The fields of an aggregate's create request: the declared record's fields,
 *  or none when the context declares no record (it serves no create). */
export function createRequestFields(
  payloads: readonly PayloadIR[],
  agg: AggregateIR,
): readonly FieldIR[] {
  return createRequestRecord(payloads, agg)?.fields ?? [];
}

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

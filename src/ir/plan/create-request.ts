// What a client sends to create an aggregate: the declared create command
// record.
//
// Every frontend's create form, its request schema, its page object and its
// i18n chrome read this one fact, so a create form never asks for a field the
// create command does not take.  An event-sourced aggregate is the case where
// it matters most: its create command is its `create` action's params, while
// its declared fields are folded state the client never sends.
//
// An aggregate whose context declares no create record falls back to the
// derived create input (`undeclaredCreateRequestFields`).  That fallback is
// the only place outside the backends that reads the derived set, and
// `test/system/create-request-census.test.ts` counts the aggregates that still
// reach it so the count only shrinks.

import { createInputFields } from "../enrich/wire-projection.js";
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
 *  or the derived create input when the context declares no record. */
export function createRequestFields(
  payloads: readonly PayloadIR[],
  agg: AggregateIR,
): readonly FieldIR[] {
  return createRequestRecord(payloads, agg)?.fields ?? undeclaredCreateRequestFields(agg);
}

/** The create request of an aggregate whose context declares no create
 *  command record: the derived create input every backend's create route
 *  reads.  Read only through `createRequestFields` and by the Frontend
 *  Contract's api module for the same case. */
export function undeclaredCreateRequestFields(agg: AggregateIR): readonly FieldIR[] {
  return createInputFields(agg);
}

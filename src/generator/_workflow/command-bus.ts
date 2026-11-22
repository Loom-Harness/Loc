import type { HandlerBinding } from "../../ir/plan/index.js";

// ---------------------------------------------------------------------------
// The command-bus leaf seam: a context's generated, statically typed dispatch
// of each command / query record to its one handler (`busEntries`,
// `src/ir/plan/command-bus.ts`), rendered through one leaf per part.
//
// The plan owns which handler catches which record; a backend only spells the
// answer in its own idiom (overloads over an exhaustive switch, a Mediator
// request, one function clause per struct).  Every handler takes
// `(record, ctx)`: `ctx` is one parameter, so later work widens `ctx` and
// never a handler signature.  A route, a workflow `send` and a test call a
// handler only through its `dispatch` leaf, never directly.  A new part is a
// required member of every backend's leaf table, so it fails to type-check
// there and nowhere else.
// ---------------------------------------------------------------------------

/** What each part is rendered from. */
interface BusPartInputs {
  /** The handler's `(record, ctx)` parameter list. */
  handlerSignature: HandlerBinding;
  /** The `dispatch<Record>(record, ctx)` unit of one record. */
  dispatch: HandlerBinding;
  /** The typed bus over every record of the context. */
  bus: readonly HandlerBinding[];
  /** The expression a route emits to call a record's dispatch. */
  routeCall: { entry: HandlerBinding; record: string; ctx: string };
}

/** What each part renders to: a signature or a call is an expression, the
 *  rest are lines. */
interface BusPartOutputs {
  handlerSignature: string;
  dispatch: string[];
  bus: string[];
  routeCall: string;
}

/** One leaf per part. */
export type CommandBusLeaves = {
  readonly [P in keyof BusPartInputs]: (input: BusPartInputs[P]) => BusPartOutputs[P];
};

/** The lines of a context's bus: each record's dispatch in plan order, then
 *  the typed bus over all of them. */
export function renderCommandBus(
  entries: readonly HandlerBinding[],
  leaves: CommandBusLeaves,
): string[] {
  return [...entries.flatMap((e) => leaves.dispatch(e)), ...leaves.bus(entries)];
}

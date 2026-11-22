// Which handler catches a command or query record.
//
// A `command` or `query` record is dispatched to exactly one handler: a
// `commandHandler` / `queryHandler` whose only parameter is that record, or a
// workflow `create` whose only parameter is that command record.  Which one
// catches a record is a decision, not a style: two backends resolving it
// differently would send the same request to different code.  It is made once
// here, and each backend renders the answer into its own dispatch.
//
// `handlersOf` lists every candidate, so the validator can refuse zero and two
// or more; `handlerFor` answers only when there is exactly one.  A handler of
// the wrong kind (a `commandHandler` taking a `query` record) is not a
// candidate for that record.

import type {
  BoundedContextIR,
  CommandHandlerIR,
  CreateIR,
  ParamIR,
  PayloadIR,
  QueryHandlerIR,
  TypeIR,
  WorkflowIR,
} from "../types/loom-ir.js";

/** A record is a write or a read. */
export type RecordKind = "command" | "query";

/** The declaration that catches a record. */
export type HandlerRef =
  | { form: "commandHandler"; name: string }
  | { form: "queryHandler"; name: string }
  | { form: "workflow-create"; name: string; workflow: string };

export interface HandlerBinding {
  kind: RecordKind;
  /** The context that declares both the record and its handler. */
  context: string;
  record: string;
  handler: HandlerRef;
  /** The handler's declared return type: set on a `commandHandler` that
   *  declares one and on every `queryHandler`; undefined for a handler that
   *  answers nothing and for a workflow `create`, whose answer is its own. */
  returnType?: TypeIR;
}

export type CommandBusContext = Pick<
  BoundedContextIR,
  "name" | "payloads" | "commandHandlers" | "queryHandlers" | "workflows"
>;

/** The record a handler or create takes as its only parameter, when it is a
 *  `command` / `query` record of the wanted kind. */
function soleRecordParam(params: readonly ParamIR[], kind: RecordKind): string | undefined {
  if (params.length !== 1) return undefined;
  const t = params[0]?.type;
  return t?.kind === "entity" && t.declKind === kind ? t.name : undefined;
}

function bindings(ctx: CommandBusContext): HandlerBinding[] {
  const out: HandlerBinding[] = [];
  const bind = (
    kind: RecordKind,
    record: string | undefined,
    handler: HandlerRef,
    returnType?: TypeIR,
  ): void => {
    if (record === undefined) return;
    out.push({
      kind,
      context: ctx.name,
      record,
      handler,
      ...(returnType === undefined ? {} : { returnType }),
    });
  };
  for (const h of ctx.commandHandlers as readonly CommandHandlerIR[]) {
    bind(
      "command",
      soleRecordParam(h.params, "command"),
      { form: "commandHandler", name: h.name },
      h.returnType,
    );
  }
  for (const h of ctx.queryHandlers as readonly QueryHandlerIR[]) {
    bind(
      "query",
      soleRecordParam(h.params, "query"),
      { form: "queryHandler", name: h.name },
      h.returnType,
    );
  }
  for (const wf of ctx.workflows as readonly WorkflowIR[]) {
    for (const c of wf.creates as readonly CreateIR[]) {
      if (c.triggerKind !== "command") continue;
      bind("command", soleRecordParam(c.params, "command"), {
        form: "workflow-create",
        name: c.name ?? "create",
        workflow: wf.name,
      });
    }
  }
  return out;
}

/** Every declaration that catches `record`, in declaration order: command
 *  handlers, then query handlers, then workflow creates. */
export function handlersOf(ctx: CommandBusContext, record: string): HandlerBinding[] {
  return bindings(ctx).filter((b) => b.record === record);
}

/** The one handler that catches `record`; undefined when none or several do
 *  (the validator refuses both). */
export function handlerFor(ctx: CommandBusContext, record: string): HandlerBinding | undefined {
  const all = handlersOf(ctx, record);
  return all.length === 1 ? all[0] : undefined;
}

/** The records a context's bus dispatches: each `command` / `query` record
 *  with its one handler, in the order the records are declared.  A record
 *  without exactly one handler has no entry. */
export function busEntries(ctx: CommandBusContext): HandlerBinding[] {
  const out: HandlerBinding[] = [];
  for (const p of ctx.payloads as readonly PayloadIR[]) {
    if (p.kind !== "command" && p.kind !== "query") continue;
    const b = handlerFor(ctx, p.name);
    if (b !== undefined && b.kind === p.kind) out.push(b);
  }
  return out;
}

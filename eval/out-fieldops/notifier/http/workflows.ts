// Auto-generated.  Do not edit by hand.
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { frameworkProblemBody, ProblemDetails, newApp } from "./problem-details";
import { HTTPException } from "hono/http-exception";
import { DomainError, AggregateNotFoundError, DisallowedError, ForbiddenError, ExternHandlerError, ConcurrencyError } from "../domain/errors";
import type { DomainEventDispatcher } from "../domain/events";
import type * as Events from "../domain/events";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { NotificationLog } from "../domain/notificationLog";
import { NotificationLogRepository } from "../db/repositories/notificationLog-repository";

const RecordCompletionInstanceResponse = z.object({
  workOrderId: z.string(),
}).openapi("RecordCompletionInstanceResponse");
const RecordCompletionInstanceListResponse = z.array(RecordCompletionInstanceResponse).openapi("RecordCompletionInstanceListResponse");

export function workflowsRoutes(
  db: NodePgDatabase<typeof schema>,
  events: DomainEventDispatcher,
): OpenAPIHono {
  const app = newApp();

  app.openapi(
    createRoute({
      method: "get",
      path: "/record_completion/instances",
      tags: ["workflows"],
      operationId: "allRecordCompletionInstances",
      responses: {
        200: { description: "OK", content: { "application/json": { schema: RecordCompletionInstanceListResponse } } },
      },
    }),
    async (httpCtx) => {
      const rows = await db.select().from(schema.recordCompletions);
      return httpCtx.json(rows as unknown as z.infer<typeof RecordCompletionInstanceListResponse>, 200);
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/record_completion/instances/{id}",
      tags: ["workflows"],
      operationId: "getRecordCompletionInstanceById",
      request: { params: z.object({ id: z.string().uuid() }) },
      responses: {
        200: { description: "OK", content: { "application/json": { schema: RecordCompletionInstanceResponse } } },
        404: { description: "Not Found", content: { "application/problem+json": { schema: ProblemDetails } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (httpCtx) => {
      const { id } = httpCtx.req.valid("param");
      const rows = await db.select().from(schema.recordCompletions).where(eq(schema.recordCompletions.workOrderId, id)).limit(1);
      const row = rows[0];
      if (!row) throw new AggregateNotFoundError(`RecordCompletion ${id} not found`);
      return httpCtx.json(row as unknown as z.infer<typeof RecordCompletionInstanceResponse>, 200);
    },
  );

  app.onError((err, c) => {
    const trace_id = c.get("requestId") ?? "";
    const failedWorkflow = c.get("workflow");
    if (failedWorkflow !== undefined) {
      c.get("log").error({ event: "workflow_failed", workflow: failedWorkflow, error: err instanceof Error ? err.message : String(err) });
    }
    const problem = (status: 400 | 403 | 404 | 409 | 422 | 500, title: string, detail: string) => c.body(JSON.stringify({ type: "about:blank", title, status, detail, instance: c.req.path }), status, { "content-type": "application/problem+json", "x-request-id": trace_id });
    if (err instanceof ForbiddenError) return problem(403, "Forbidden", err.message);
    if (err instanceof DisallowedError) return problem(409, "Disallowed", err.message);
    if (err instanceof DomainError) return problem(422, "Unprocessable Entity", err.message);
    if (err instanceof AggregateNotFoundError) return problem(404, "Not Found", err.message);
    if (err instanceof ConcurrencyError) return problem(409, "Conflict", err.message);
    if (err instanceof ExternHandlerError) { c.get("log").error({ event: "extern_handler_threw", aggregate: err.aggName, op: err.opName, error: err.message }); return problem(500, "Internal Server Error", "internal"); }
    if (err instanceof HTTPException) { c.get("log").warn({ event: "client_error", error: err.message, status: err.status }); return c.body(frameworkProblemBody(err.status, err.message, c.req.path), err.status, { "content-type": "application/problem+json", "x-request-id": trace_id }); }
    c.get("log").error({ event: "internal_error", error: err instanceof Error ? err.message : String(err), status: 500 });
    return problem(500, "Internal Server Error", "internal");
  });

  return app;
}

type RecordCompletionState = typeof schema.recordCompletions.$inferInsert;
async function loadRecordCompletion(
  db: NodePgDatabase<typeof schema>,
  key: string,
): Promise<RecordCompletionState | undefined> {
  const rows = await db.select().from(schema.recordCompletions).where(eq(schema.recordCompletions.workOrderId, key)).limit(1);
  return rows[0];
}
async function saveRecordCompletion(db: NodePgDatabase<typeof schema>, state: RecordCompletionState): Promise<void> {
  await db.insert(schema.recordCompletions).values(state).onConflictDoUpdate({ target: schema.recordCompletions.workOrderId, set: state });
}

export async function recordCompletionStartWorkOrderCompleted(
  db: NodePgDatabase<typeof schema>,
  events: DomainEventDispatcher,
  p: Events.WorkOrderCompleted,
): Promise<void> {
  const __key = p.workOrder;
  const state = (await loadRecordCompletion(db, __key)) ?? { workOrderId: __key };
  const notificationLogs = new NotificationLogRepository(db, events);
  const entry = NotificationLog.create({ workOrderId: p.workOrder, sentAt: p.at });
  await notificationLogs.save(entry);
  await saveRecordCompletion(db, state);
}

export function createInProcessDispatcher(
  db: NodePgDatabase<typeof schema>,
): DomainEventDispatcher {
  const dispatcher: DomainEventDispatcher = {
    async dispatch(event: Events.DomainEvent): Promise<void> {
      switch (event.type) {
        case "WorkOrderCompleted": {
          await recordCompletionStartWorkOrderCompleted(db, dispatcher, event);
          break;
        }
        default:
          break;
      }
    },
  };
  return dispatcher;
}

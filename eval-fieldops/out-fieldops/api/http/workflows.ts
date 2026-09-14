// Auto-generated.  Do not edit by hand.
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { frameworkProblemBody, ProblemDetails, newApp, requireJsonContentType } from "./problem-details.ts";
import { HTTPException } from "hono/http-exception";
import * as Ids from "../domain/ids.ts";
import { DomainError, AggregateNotFoundError, DisallowedError, ForbiddenError, ExternHandlerError, ConcurrencyError } from "../domain/errors.ts";
import type { DomainEventDispatcher } from "../domain/events.ts";
import type * as Events from "../domain/events.ts";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { requestLog } from "../obs/als.ts";
import type * as schema from "../db/schema.ts";
import { TechnicianRepository } from "../db/repositories/technician-repository.ts";
import { WorkOrderRepository } from "../db/repositories/workOrder-repository.ts";

const ScheduleWorkOrderRequest = z.object({
  workOrder: z.string().uuid(),
  technician: z.string().uuid(),
  at: z.string().datetime({ offset: true, local: true }).transform((s: string) => new Date(s)),
}).openapi("ScheduleWorkOrderRequest");

export function workflowsRoutes(
  db: NodePgDatabase<typeof schema>,
  events: DomainEventDispatcher,
): OpenAPIHono {
  const app = newApp();

  app.openapi(
    createRoute({
      method: "post",
      path: "/schedule_work_order",
      tags: ["workflows"],
      operationId: "scheduleWorkOrderWorkflow",
      request: {
        body: { content: { "application/json": { schema: ScheduleWorkOrderRequest } } },
      },
      responses: {
        204: { description: "No content" },
        400: { description: "Bad Request", content: { "application/problem+json": { schema: ProblemDetails } } },
        404: { description: "Not Found", content: { "application/problem+json": { schema: ProblemDetails } } },
        415: { description: "Unsupported Media Type", content: { "application/problem+json": { schema: ProblemDetails } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
        403: { description: "Forbidden", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (httpCtx) => {
      requireJsonContentType(httpCtx);
      const body = httpCtx.req.valid("json");
      requestLog().info({ event: "workflow_started", workflow: "scheduleWorkOrder" });
      httpCtx.set("workflow", "scheduleWorkOrder");
      const workOrder = Ids.WorkOrderId(body.workOrder);
      const technician = Ids.TechnicianId(body.technician);
      const at = body.at;
      const currentUser = (httpCtx as unknown as { get(k: "currentUser"): import("../auth/user-types.ts").User }).get("currentUser");
      const workflowEvents: Events.DomainEvent[] = [];
      await db.transaction(async (tx) => {
        const workOrders = new WorkOrderRepository(tx, events);
        const technicians = new TechnicianRepository(tx, events);
        if (!((currentUser.permissions).includes("ops.manageWorkOrders"))) throw new ForbiddenError("Forbidden: currentUser.permissions.contains(permissions.manageWorkOrders)");
        const wo = await workOrders.getById(workOrder);
        const tech = await technicians.getById(technician);
        if (!((currentUser.permissions).includes("ops.manageWorkOrders"))) throw new ForbiddenError("Forbidden: currentUser.permissions.contains(permissions.manageWorkOrders)");
        wo.schedule(technician, at);
        workflowEvents.push({ type: "WorkOrderScheduled", workOrder: workOrder, technician: technician, at: at });
        await workOrders.save(wo);
      });
      for (const ev of workflowEvents) await events.dispatch(ev);
      requestLog().info({ event: "workflow_completed", workflow: "scheduleWorkOrder" });
      return httpCtx.body(null, 204);
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
    if (err && typeof err === "object" && (((err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code) === "23505")) return problem(409, "Conflict", "A record with these values already exists.");
    if (err instanceof ConcurrencyError) return problem(409, "Conflict", err.message);
    if (err instanceof ExternHandlerError) { c.get("log").error({ event: "extern_handler_threw", aggregate: err.aggName, op: err.opName, error: err.message }); return problem(500, "Internal Server Error", "internal"); }
    if (err instanceof HTTPException) { c.get("log").warn({ event: "client_error", error: err.message, status: err.status }); return c.body(frameworkProblemBody(err.status, err.message, c.req.path), err.status, { "content-type": "application/problem+json", "x-request-id": trace_id }); }
    c.get("log").error({ event: "internal_error", error: err instanceof Error ? err.message : String(err), status: 500 });
    return problem(500, "Internal Server Error", "internal");
  });

  return app;
}
//# sourceMappingURL=workflows.ts.map

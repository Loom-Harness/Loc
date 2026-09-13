// Auto-generated.  Do not edit by hand.
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { frameworkProblemBody, ProblemDetails, newApp, requireJsonContentType } from "./problem-details";
import { HTTPException } from "hono/http-exception";
import * as Ids from "../domain/ids";
import { DomainError, AggregateNotFoundError, DisallowedError, ForbiddenError, ExternHandlerError, ConcurrencyError } from "../domain/errors";
import type { DomainEventDispatcher } from "../domain/events";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { requestLog } from "../obs/als";
import type * as schema from "../db/schema";
import { TechnicianRepository } from "../db/repositories/technician-repository";
import { PartRepository } from "../db/repositories/part-repository";
import { WorkOrderRepository } from "../db/repositories/workOrder-repository";

const ScheduleWorkOrderRequest = z.object({
  workOrderId: z.string().uuid(),
  assignTo: z.string().uuid(),
  at: z.string().datetime({ offset: true, local: true }).transform((s: string) => new Date(s)),
}).openapi("ScheduleWorkOrderRequest");
const CompleteAndConsumePartRequest = z.object({
  workOrderId: z.string().uuid(),
  note: z.string(),
  partId: z.string().uuid(),
  qty: z.number().int().min(-2147483648).max(2147483647).openapi({ format: "int32" }),
}).openapi("CompleteAndConsumePartRequest");

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
      const workOrderId = Ids.WorkOrderId(body.workOrderId);
      const assignTo = Ids.TechnicianId(body.assignTo);
      const at = body.at;
      const currentUser = (httpCtx as unknown as { get(k: "currentUser"): import("../auth/user-types").User }).get("currentUser");
      await db.transaction(async (tx) => {
        const technicians = new TechnicianRepository(tx, events);
        const workOrders = new WorkOrderRepository(tx, events);
        if (!(currentUser.role === "admin" || currentUser.role === "dispatcher")) throw new ForbiddenError("Forbidden: currentUser.role == \"admin\" || currentUser.role == \"dispatcher\"");
        const tech = await technicians.getById(assignTo);
        const wo = await workOrders.getById(workOrderId);
        if (!(tech.skills.length > 0)) throw new DomainError("Precondition failed: tech.skills.count > 0");
        if (!(currentUser.role === "admin" || currentUser.role === "dispatcher")) throw new ForbiddenError("Forbidden: currentUser.role == \"admin\" || currentUser.role == \"dispatcher\"");
        wo.assignTechnician(assignTo, tech.userId, at);
        await workOrders.save(wo);
      });
      requestLog().info({ event: "workflow_completed", workflow: "scheduleWorkOrder" });
      return httpCtx.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/complete_and_consume_part",
      tags: ["workflows"],
      operationId: "completeAndConsumePartWorkflow",
      request: {
        body: { content: { "application/json": { schema: CompleteAndConsumePartRequest } } },
      },
      responses: {
        204: { description: "No content" },
        400: { description: "Bad Request", content: { "application/problem+json": { schema: ProblemDetails } } },
        404: { description: "Not Found", content: { "application/problem+json": { schema: ProblemDetails } } },
        415: { description: "Unsupported Media Type", content: { "application/problem+json": { schema: ProblemDetails } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (httpCtx) => {
      requireJsonContentType(httpCtx);
      const body = httpCtx.req.valid("json");
      requestLog().info({ event: "workflow_started", workflow: "completeAndConsumePart" });
      httpCtx.set("workflow", "completeAndConsumePart");
      const workOrderId = Ids.WorkOrderId(body.workOrderId);
      const note = body.note;
      const partId = Ids.PartId(body.partId);
      const qty = body.qty;
      await db.transaction(async (tx) => {
        const parts = new PartRepository(tx, events);
        const workOrders = new WorkOrderRepository(tx, events);
        const part = await parts.getById(partId);
        part.decrement(qty);
        const wo = await workOrders.getById(workOrderId);
        wo.complete(note);
        await parts.save(part);
        await workOrders.save(wo);
      });
      requestLog().info({ event: "workflow_completed", workflow: "completeAndConsumePart" });
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
    if (err instanceof ConcurrencyError) return problem(409, "Conflict", err.message);
    if (err instanceof ExternHandlerError) { c.get("log").error({ event: "extern_handler_threw", aggregate: err.aggName, op: err.opName, error: err.message }); return problem(500, "Internal Server Error", "internal"); }
    if (err instanceof HTTPException) { c.get("log").warn({ event: "client_error", error: err.message, status: err.status }); return c.body(frameworkProblemBody(err.status, err.message, c.req.path), err.status, { "content-type": "application/problem+json", "x-request-id": trace_id }); }
    c.get("log").error({ event: "internal_error", error: err instanceof Error ? err.message : String(err), status: 500 });
    return problem(500, "Internal Server Error", "internal");
  });

  return app;
}

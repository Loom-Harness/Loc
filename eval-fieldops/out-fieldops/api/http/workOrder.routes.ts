// Auto-generated.  Do not edit by hand.
import { moneySchema } from "../lib/schemas.ts";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { ProblemDetails, frameworkProblemBody, newApp, requireJsonContentType, versionETag } from "./problem-details.ts";
import { HTTPException } from "hono/http-exception";
import { recordDomainFault, recordDomainOperation } from "../obs/metrics.ts";
import { WorkOrder } from "../domain/workOrder.ts";
import type { WorkOrderRepository } from "../db/repositories/workOrder-repository.ts";
import * as Ids from "../domain/ids.ts";
import { DomainError, AggregateNotFoundError, DisallowedError, ForbiddenError, ExternHandlerError, ConcurrencyError } from "../domain/errors.ts";
import { WorkOrderStatus } from "../domain/value-objects.ts";

const WorkOrderStatusSchema = z.enum(["Draft", "Scheduled", "InProgress", "Completed", "Cancelled"]).openapi("WorkOrderStatus");
const PrioritySchema = z.enum(["Low", "Normal", "High", "Urgent"]).openapi("Priority");

const CreateWorkOrderRequest = z.object({
  customerId: z.string().uuid(),
  siteId: z.string().uuid(),
  assetId: z.string().uuid().nullish(),
  technicianId: z.string().uuid().nullish(),
  technicianUserId: z.string().nullish(),
  status: WorkOrderStatusSchema,
  priority: PrioritySchema,
  currency: z.string().refine((s) => [...s].length === 3, { message: "Currency must be exactly 3 characters" }).openapi({ minLength: 3, maxLength: 3 }).refine((s: string) => !s.includes("\u0000")),
  scheduledAt: z.string().datetime({ offset: true, local: true }).transform((s: string) => new Date(s)).nullish(),
  startedAt: z.string().datetime({ offset: true, local: true }).transform((s: string) => new Date(s)).nullish(),
  completedAt: z.string().datetime({ offset: true, local: true }).transform((s: string) => new Date(s)).nullish(),
  resolutionNote: z.string().nullish(),
  photo: z.object({ url: z.string(), key: z.string(), contentType: z.string(), size: z.number().int() }).nullish(),
}).openapi("CreateWorkOrderRequest");
const CreateWorkOrderResponse = z.object({ id: z.string() }).openapi("CreateWorkOrderResponse");

const AddLabourWorkOrderRequest = z.object({
  description: z.string().refine((s: string) => !s.includes("\u0000")),
  hours: z.number().gt(0, { message: "Hours must be greater than 0" }),
  rate: moneySchema,
  lineCurrency: z.string().refine((s: string) => !s.includes("\u0000")),
}).openapi("AddLabourWorkOrderRequest");
const ScheduleWorkOrderRequest = z.object({
  tech: z.string().uuid(),
  at: z.string().datetime({ offset: true, local: true }).transform((s: string) => new Date(s)),
}).openapi("ScheduleWorkOrderRequest");
const StartWorkOrderRequest = z.object({
}).openapi("StartWorkOrderRequest");
const CompleteWorkOrderRequest = z.object({
  note: z.string().refine((s: string) => !s.includes("\u0000")),
}).openapi("CompleteWorkOrderRequest");
const CancelWorkOrderRequest = z.object({
  reason: z.string().refine((s: string) => !s.includes("\u0000")),
}).openapi("CancelWorkOrderRequest");

const AllQuery = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  sort: z.enum(["id", "status", "priority", "currency", "createdAt", "updatedAt", "createdBy", "updatedBy", ""]).default("id"),
  dir: z.string().default("asc"),
}).openapi("AllQuery");
export const WorkOrderLineResponse = z.object({
  id: z.string(),
  description: z.string(),
  quantity: z.number(),
  unitPrice: z.string(),
  currency: z.string(),
  amount: z.string(),
}).openapi("WorkOrderLineResponse");
export const WorkOrderResponse = z.object({
  id: z.string(),
  customerId: z.string(),
  siteId: z.string(),
  assetId: z.string().nullish(),
  technicianId: z.string().nullish(),
  technicianUserId: z.string().nullish(),
  status: WorkOrderStatusSchema,
  priority: PrioritySchema,
  currency: z.string(),
  scheduledAt: z.string().nullish(),
  startedAt: z.string().nullish(),
  completedAt: z.string().nullish(),
  resolutionNote: z.string().nullish(),
  photo: z.object({ url: z.string(), key: z.string(), contentType: z.string(), size: z.number().int() }).nullish(),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: z.string(),
  updatedBy: z.string(),
  version: z.number().int().openapi({ format: "int32" }),
  lines: z.array(WorkOrderLineResponse),
  total: z.string(),
  display: z.string(),
  timeToComplete: z.number().int().openapi({ format: "int32" }),
}).openapi("WorkOrderResponse");
export const WorkOrderListResponse = z.array(WorkOrderResponse).openapi("WorkOrderListResponse");
export const WorkOrderPaged = z.object({ items: z.array(WorkOrderResponse), page: z.number().int(), pageSize: z.number().int(), total: z.number().int(), totalPages: z.number().int() }).openapi("WorkOrderPaged");

export function workOrderRoutes(repo: WorkOrderRepository): OpenAPIHono {
  const app = newApp();

  app.openapi(
    createRoute({
      method: "post",
      path: "/",
      tags: ["work_orders"],
      operationId: "createWorkOrder",
      request: {
        body: { content: { "application/json": { schema: CreateWorkOrderRequest } } },
      },
      responses: {
        201: {
          description: "Created",
          content: { "application/json": { schema: CreateWorkOrderResponse } },
        },
        400: { description: "Bad Request", content: { "application/problem+json": { schema: ProblemDetails } } },
        415: { description: "Unsupported Media Type", content: { "application/problem+json": { schema: ProblemDetails } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      requireJsonContentType(c);
      const body = c.req.valid("json");
      const created = WorkOrder.create({ customerId: Ids.CustomerId(body.customerId), siteId: Ids.SiteId(body.siteId), assetId: (body.assetId == null ? null : Ids.AssetId(body.assetId)), technicianId: (body.technicianId == null ? null : Ids.TechnicianId(body.technicianId)), technicianUserId: (body.technicianUserId == null ? null : body.technicianUserId), status: body.status, priority: body.priority, currency: body.currency, scheduledAt: (body.scheduledAt == null ? null : body.scheduledAt), startedAt: (body.startedAt == null ? null : body.startedAt), completedAt: (body.completedAt == null ? null : body.completedAt), resolutionNote: (body.resolutionNote == null ? null : body.resolutionNote), photo: (body.photo == null ? null : body.photo) });
      await repo.save(created);
      c.get("log").info({ event: "aggregate_created", aggregate: "WorkOrder", id: created.id as string });
      recordDomainOperation("WorkOrder", "create");
      return c.json({ id: created.id as string }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/{id}",
      tags: ["work_orders"],
      operationId: "getWorkOrderById",
      request: { params: z.object({ id: z.string().uuid() }) },
      responses: {
        200: { description: "OK", content: { "application/json": { schema: WorkOrderResponse } } },
        404: { description: "Not Found", content: { "application/problem+json": { schema: ProblemDetails } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const found = await repo.findById(Ids.WorkOrderId(id));
      if (!found) throw new AggregateNotFoundError(`WorkOrder ${id} not found`);
      c.header("etag", versionETag(found.version));
      return c.json(repo.toWire(found) as z.infer<typeof WorkOrderResponse>, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/{id}/add_labour",
      tags: ["work_orders"],
      operationId: "addLabourWorkOrder",
      request: {
        params: z.object({ id: z.string().uuid() }),
        body: { content: { "application/json": { schema: AddLabourWorkOrderRequest } } },
      },
      responses: {
        204: { description: "No content" },
        400: { description: "Bad Request", content: { "application/problem+json": { schema: ProblemDetails } } },
        403: { description: "Forbidden", content: { "application/problem+json": { schema: ProblemDetails } } },
        404: { description: "Not Found", content: { "application/problem+json": { schema: ProblemDetails } } },
        415: { description: "Unsupported Media Type", content: { "application/problem+json": { schema: ProblemDetails } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      requireJsonContentType(c);
      const body = c.req.valid("json");
      c.get("log").info({ event: "operation_invoked", aggregate: "WorkOrder", op: "addLabour", id });
      recordDomainOperation("WorkOrder", "addLabour");
      const currentUser = (c as unknown as { get(k: "currentUser"): import("../auth/user-types.ts").User }).get("currentUser");
      const aggregate = await repo.getById(Ids.WorkOrderId(id));
      if (!((currentUser.permissions).includes("ops.manageWorkOrders"))) throw new ForbiddenError("Forbidden: currentUser.permissions.contains(permissions.manageWorkOrders)");
      aggregate.addLabour(body.description, body.hours, body.rate, body.lineCurrency);
      await repo.save(aggregate);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/{id}/schedule",
      tags: ["work_orders"],
      operationId: "scheduleWorkOrder",
      request: {
        params: z.object({ id: z.string().uuid() }),
        body: { content: { "application/json": { schema: ScheduleWorkOrderRequest } } },
      },
      responses: {
        204: { description: "No content" },
        400: { description: "Bad Request", content: { "application/problem+json": { schema: ProblemDetails } } },
        403: { description: "Forbidden", content: { "application/problem+json": { schema: ProblemDetails } } },
        404: { description: "Not Found", content: { "application/problem+json": { schema: ProblemDetails } } },
        409: { description: "Conflict", content: { "application/problem+json": { schema: ProblemDetails } } },
        415: { description: "Unsupported Media Type", content: { "application/problem+json": { schema: ProblemDetails } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      requireJsonContentType(c);
      const body = c.req.valid("json");
      c.get("log").info({ event: "operation_invoked", aggregate: "WorkOrder", op: "schedule", id });
      recordDomainOperation("WorkOrder", "schedule");
      const currentUser = (c as unknown as { get(k: "currentUser"): import("../auth/user-types.ts").User }).get("currentUser");
      const aggregate = await repo.getById(Ids.WorkOrderId(id));
      if (!((currentUser.permissions).includes("ops.manageWorkOrders"))) throw new ForbiddenError("Forbidden: currentUser.permissions.contains(permissions.manageWorkOrders)");
      if (!(aggregate.status === WorkOrderStatus.Draft)) throw new DisallowedError("operation 'schedule' is not allowed in the current state of WorkOrder.");
      aggregate.schedule(Ids.TechnicianId(body.tech), body.at);
      await repo.save(aggregate);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/{id}/can_schedule",
      tags: ["work_orders"],
      operationId: "can_scheduleWorkOrder",
      request: {
        params: z.object({ id: z.string().uuid() }),
      },
      responses: {
        200: { description: "OK", content: { "application/json": { schema: z.object({ allowed: z.boolean() }) } } },
        404: { description: "Not Found", content: { "application/problem+json": { schema: ProblemDetails } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const aggregate = await repo.getById(Ids.WorkOrderId(id));
      return c.json({ allowed: aggregate.status === WorkOrderStatus.Draft }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/{id}/start",
      tags: ["work_orders"],
      operationId: "startWorkOrder",
      request: {
        params: z.object({ id: z.string().uuid() }),
        body: { content: { "application/json": { schema: StartWorkOrderRequest } } },
      },
      responses: {
        204: { description: "No content" },
        400: { description: "Bad Request", content: { "application/problem+json": { schema: ProblemDetails } } },
        404: { description: "Not Found", content: { "application/problem+json": { schema: ProblemDetails } } },
        409: { description: "Conflict", content: { "application/problem+json": { schema: ProblemDetails } } },
        415: { description: "Unsupported Media Type", content: { "application/problem+json": { schema: ProblemDetails } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      requireJsonContentType(c);
      const body = c.req.valid("json");
      c.get("log").info({ event: "operation_invoked", aggregate: "WorkOrder", op: "start", id });
      recordDomainOperation("WorkOrder", "start");
      const aggregate = await repo.getById(Ids.WorkOrderId(id));
      if (!(aggregate.status === WorkOrderStatus.Scheduled)) throw new DisallowedError("operation 'start' is not allowed in the current state of WorkOrder.");
      aggregate.start();
      await repo.save(aggregate);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/{id}/can_start",
      tags: ["work_orders"],
      operationId: "can_startWorkOrder",
      request: {
        params: z.object({ id: z.string().uuid() }),
      },
      responses: {
        200: { description: "OK", content: { "application/json": { schema: z.object({ allowed: z.boolean() }) } } },
        404: { description: "Not Found", content: { "application/problem+json": { schema: ProblemDetails } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const aggregate = await repo.getById(Ids.WorkOrderId(id));
      return c.json({ allowed: aggregate.status === WorkOrderStatus.Scheduled }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/{id}/complete",
      tags: ["work_orders"],
      operationId: "completeWorkOrder",
      request: {
        params: z.object({ id: z.string().uuid() }),
        body: { content: { "application/json": { schema: CompleteWorkOrderRequest } } },
      },
      responses: {
        204: { description: "No content" },
        400: { description: "Bad Request", content: { "application/problem+json": { schema: ProblemDetails } } },
        404: { description: "Not Found", content: { "application/problem+json": { schema: ProblemDetails } } },
        409: { description: "Conflict", content: { "application/problem+json": { schema: ProblemDetails } } },
        415: { description: "Unsupported Media Type", content: { "application/problem+json": { schema: ProblemDetails } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      requireJsonContentType(c);
      const body = c.req.valid("json");
      c.get("log").info({ event: "operation_invoked", aggregate: "WorkOrder", op: "complete", id });
      recordDomainOperation("WorkOrder", "complete");
      const aggregate = await repo.getById(Ids.WorkOrderId(id));
      if (!(aggregate.status === WorkOrderStatus.InProgress)) throw new DisallowedError("operation 'complete' is not allowed in the current state of WorkOrder.");
      aggregate.complete(body.note);
      await repo.save(aggregate);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/{id}/can_complete",
      tags: ["work_orders"],
      operationId: "can_completeWorkOrder",
      request: {
        params: z.object({ id: z.string().uuid() }),
      },
      responses: {
        200: { description: "OK", content: { "application/json": { schema: z.object({ allowed: z.boolean() }) } } },
        404: { description: "Not Found", content: { "application/problem+json": { schema: ProblemDetails } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const aggregate = await repo.getById(Ids.WorkOrderId(id));
      return c.json({ allowed: aggregate.status === WorkOrderStatus.InProgress }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/{id}/cancel",
      tags: ["work_orders"],
      operationId: "cancelWorkOrder",
      request: {
        params: z.object({ id: z.string().uuid() }),
        body: { content: { "application/json": { schema: CancelWorkOrderRequest } } },
      },
      responses: {
        204: { description: "No content" },
        400: { description: "Bad Request", content: { "application/problem+json": { schema: ProblemDetails } } },
        404: { description: "Not Found", content: { "application/problem+json": { schema: ProblemDetails } } },
        409: { description: "Conflict", content: { "application/problem+json": { schema: ProblemDetails } } },
        415: { description: "Unsupported Media Type", content: { "application/problem+json": { schema: ProblemDetails } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      requireJsonContentType(c);
      const body = c.req.valid("json");
      c.get("log").info({ event: "operation_invoked", aggregate: "WorkOrder", op: "cancel", id });
      recordDomainOperation("WorkOrder", "cancel");
      const aggregate = await repo.getById(Ids.WorkOrderId(id));
      if (!(aggregate.status !== WorkOrderStatus.Completed)) throw new DisallowedError("operation 'cancel' is not allowed in the current state of WorkOrder.");
      aggregate.cancel(body.reason);
      await repo.save(aggregate);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/{id}/can_cancel",
      tags: ["work_orders"],
      operationId: "can_cancelWorkOrder",
      request: {
        params: z.object({ id: z.string().uuid() }),
      },
      responses: {
        200: { description: "OK", content: { "application/json": { schema: z.object({ allowed: z.boolean() }) } } },
        404: { description: "Not Found", content: { "application/problem+json": { schema: ProblemDetails } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const aggregate = await repo.getById(Ids.WorkOrderId(id));
      return c.json({ allowed: aggregate.status !== WorkOrderStatus.Completed }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["work_orders"],
      operationId: "allWorkOrder",
      request: { query: AllQuery },
      responses: {
        200: { description: "OK", content: { "application/json": { schema: WorkOrderPaged } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      const params = c.req.valid("query");
      const result = await repo.all(params.page, params.pageSize, params.sort, params.dir);
      return c.json({ ...result, items: result.items.map((r) => repo.toWire(r)) } as z.infer<typeof WorkOrderPaged>, 200);
    },
  );

  app.onError((err, c) => {
    const trace_id = c.get("requestId") ?? "";
    const problem = (status: 403 | 404 | 409 | 422 | 500, title: string, detail: string) => c.body(JSON.stringify({ type: "about:blank", title, status, detail, instance: c.req.path }), status, { "content-type": "application/problem+json", "x-request-id": trace_id });
    if (err instanceof ForbiddenError) {
      c.get("log").warn({ event: "forbidden", aggregate: "WorkOrder", message: err.message, status: 403 });
      recordDomainFault("forbidden");
      return problem(403, "Forbidden", err.message);
    }
    if (err instanceof DisallowedError) {
      c.get("log").warn({ event: "disallowed", aggregate: "WorkOrder", message: err.message, status: 409 });
      recordDomainFault("disallowed");
      return problem(409, "Disallowed", err.message);
    }
    if (err instanceof DomainError) {
      c.get("log").warn({ event: "domain_error", aggregate: "WorkOrder", message: err.message, status: 422 });
      recordDomainFault("domain_error");
      return problem(422, "Unprocessable Entity", err.message);
    }
    if (err instanceof AggregateNotFoundError) {
      c.get("log").warn({ event: "not_found", aggregate: "WorkOrder", status: 404 });
      recordDomainFault("not_found");
      return problem(404, "Not Found", err.message);
    }
    if (err && typeof err === "object" && (((err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code) === "23503")) {
      c.get("log").warn({ event: "domain_error", aggregate: "WorkOrder", message: "The request references a record that does not exist.", status: 422 });
      recordDomainFault("domain_error");
      return problem(422, "Unprocessable Entity", "The request references a record that does not exist.");
    }
    if (err instanceof ConcurrencyError) {
      c.get("log").warn({ event: "conflict", aggregate: "WorkOrder", message: err.message, status: 409 });
      recordDomainFault("conflict");
      return problem(409, "Conflict", err.message);
    }
    if (err instanceof ExternHandlerError) {
      c.get("log").error({ event: "extern_handler_threw", aggregate: err.aggName, op: err.opName, error: err.message });
      return problem(500, "Internal Server Error", "internal");
    }
    if (err instanceof HTTPException) {
      c.get("log").warn({ event: "client_error", error: err.message, status: err.status });
      return c.body(frameworkProblemBody(err.status, err.message, c.req.path), err.status, { "content-type": "application/problem+json", "x-request-id": trace_id });
    }
    c.get("log").error({ event: "internal_error", error: err instanceof Error ? err.message : String(err), status: 500 });
    return problem(500, "Internal Server Error", "internal");
  });

  return app;
}
//# sourceMappingURL=workOrder.routes.ts.map

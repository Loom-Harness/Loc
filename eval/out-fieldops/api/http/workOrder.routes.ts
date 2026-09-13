// Auto-generated.  Do not edit by hand.
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { ProblemDetails, frameworkProblemBody, newApp, parseIfMatch, requireJsonContentType, versionETag } from "./problem-details";
import { HTTPException } from "hono/http-exception";
import { recordDomainFault, recordDomainOperation } from "../obs/metrics";
import { WorkOrder } from "../domain/workOrder";
import type { WorkOrderRepository } from "../db/repositories/workOrder-repository";
import * as Ids from "../domain/ids";
import { DomainError, AggregateNotFoundError, DisallowedError, ForbiddenError, ExternHandlerError, ConcurrencyError, NotImplementedError } from "../domain/errors";
import { Money } from "../domain/value-objects";

const WorkOrderStatusSchema = z.enum(["Draft", "Scheduled", "InProgress", "Completed", "Cancelled"]).openapi("WorkOrderStatus");
const PrioritySchema = z.enum(["Low", "Normal", "High", "Urgent"]).openapi("Priority");
const LineKindSchema = z.enum(["Labour", "Parts"]).openapi("LineKind");
const MoneySchema = z.object({
  amount: z.number().min(0, { message: "Amount must be at least 0" }),
  currency: z.string().refine((s) => [...s].length === 3, { message: "Currency must be exactly 3 characters" }).openapi({ minLength: 3, maxLength: 3 }).refine((s: string) => !s.includes("\u0000")),
}).openapi("Money");

const CreateWorkOrderRequest = z.object({
  customerId: z.string().uuid(),
  siteId: z.string().uuid(),
  assetId: z.string().uuid().nullish(),
  technicianId: z.string().uuid().nullish(),
  technicianUserId: z.string().nullish(),
  status: WorkOrderStatusSchema,
  priority: PrioritySchema,
  currency: z.string().refine((s: string) => !s.includes("\u0000")),
  scheduledAt: z.string().datetime({ offset: true, local: true }).transform((s: string) => new Date(s)).nullish(),
  startedAt: z.string().datetime({ offset: true, local: true }).transform((s: string) => new Date(s)).nullish(),
  completedAt: z.string().datetime({ offset: true, local: true }).transform((s: string) => new Date(s)).nullish(),
  resolutionNote: z.string().nullish(),
}).openapi("CreateWorkOrderRequest");
const CreateWorkOrderResponse = z.object({ id: z.string() }).openapi("CreateWorkOrderResponse");

const AssignTechnicianWorkOrderRequest = z.object({
  assignTo: z.string().uuid(),
  assignedUserId: z.string().refine((s: string) => !s.includes("\u0000")),
  at: z.string().datetime({ offset: true, local: true }).transform((s: string) => new Date(s)),
}).openapi("AssignTechnicianWorkOrderRequest");
const StartWorkOrderRequest = z.object({
}).openapi("StartWorkOrderRequest");
const AddLineWorkOrderRequest = z.object({
  kind: LineKindSchema,
  description: z.string().refine((s: string) => !s.includes("\u0000")),
  partId: z.string().uuid().nullish(),
  quantity: z.number().int().openapi({ format: "int32" }).min(1, { message: "Quantity must be at least 1" }),
  unitPrice: MoneySchema,
}).openapi("AddLineWorkOrderRequest");
const CompleteWorkOrderRequest = z.object({
  note: z.string().refine((s: string) => !s.includes("\u0000")),
}).openapi("CompleteWorkOrderRequest");
const CancelWorkOrderRequest = z.object({
}).openapi("CancelWorkOrderRequest");
const NotifyCustomerWorkOrderRequest = z.object({
}).openapi("NotifyCustomerWorkOrderRequest");
const AttachPhotoWorkOrderRequest = z.object({
  file: z.object({ url: z.string(), key: z.string(), contentType: z.string(), size: z.number().int() }),
  caption: z.string().refine((s: string) => !s.includes("\u0000")),
}).openapi("AttachPhotoWorkOrderRequest");
const UpdateWorkOrderRequest = z.object({
  customerId: z.string().uuid(),
  siteId: z.string().uuid(),
  assetId: z.string().uuid().nullish(),
  technicianId: z.string().uuid().nullish(),
  technicianUserId: z.string().nullish(),
  status: WorkOrderStatusSchema,
  priority: PrioritySchema,
  currency: z.string().refine((s: string) => !s.includes("\u0000")),
  scheduledAt: z.string().datetime({ offset: true, local: true }).transform((s: string) => new Date(s)).nullish(),
  startedAt: z.string().datetime({ offset: true, local: true }).transform((s: string) => new Date(s)).nullish(),
  completedAt: z.string().datetime({ offset: true, local: true }).transform((s: string) => new Date(s)).nullish(),
  resolutionNote: z.string().nullish(),
}).openapi("UpdateWorkOrderRequest");

const AllQuery = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  sort: z.enum(["id", "status", "priority", "currency", ""]).default("id"),
  dir: z.string().default("asc"),
}).openapi("AllQuery");
export const PhotoResponse = z.object({
  id: z.string(),
  file: z.object({ url: z.string(), key: z.string(), contentType: z.string(), size: z.number().int() }),
  caption: z.string(),
}).openapi("PhotoResponse");
export const WorkOrderLineResponse = z.object({
  id: z.string(),
  kind: LineKindSchema,
  description: z.string(),
  partId: z.string().nullish(),
  quantity: z.number().int().openapi({ format: "int32" }),
  unitPrice: MoneySchema,
  subtotal: MoneySchema,
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
  version: z.number().int().openapi({ format: "int32" }),
  lines: z.array(WorkOrderLineResponse),
  photos: z.array(PhotoResponse),
  display: z.string(),
  total: MoneySchema,
}).openapi("WorkOrderResponse");
export const WorkOrderListResponse = z.array(WorkOrderResponse).openapi("WorkOrderListResponse");
export const WorkOrderPaged = z.object({ items: z.array(WorkOrderResponse), page: z.number().int(), pageSize: z.number().int(), total: z.number().int(), totalPages: z.number().int() }).openapi("WorkOrderPaged");

export function workOrderRoutes(repo: WorkOrderRepository): OpenAPIHono {
  const app = newApp();

  // A STATIC sub-path is captured by the sibling `/{id}` route under any
  // verb it does not itself serve, and the param validator then answers 422
  // for a path that has no such method at all.  405 is the honest answer and
  // the only one that can carry an `Allow` the caller can act on (RFC 9110
  // §15.5.6).  Runs BEFORE the param validator, which is why it is a
  // middleware; registered under method ALL, so the root router's
  // method probe (http/index.ts) is unaffected.
  const staticSubpathMethods: Record<string, string[]> = { mine: ["GET"], across_all_tenants: ["GET"] };
  app.use("/:__seg", async (c, next) => {
    const __seg = c.req.path.slice(c.req.path.lastIndexOf("/") + 1);
    // `Object.hasOwn`, never a bare index: the segment is CALLER-supplied,
    // so a plain lookup reaches Object.prototype — `/api/items/constructor`
    // resolved to a function, passed the truthiness guard, and threw on
    // `.includes` (a 500 from an ordinary URL).  Own keys only.
    const allow = Object.hasOwn(staticSubpathMethods, __seg)
      ? staticSubpathMethods[__seg]
      : undefined;
    if (allow && !allow.includes(c.req.method)) {
      return c.body(
        frameworkProblemBody(405, `method ${c.req.method} is not supported for ${c.req.path}`, c.req.path),
        405,
        { "content-type": "application/problem+json", allow: allow.join(", ") },
      );
    }
    await next();
  });

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
      const created = WorkOrder.create({ customerId: Ids.CustomerId(body.customerId), siteId: Ids.SiteId(body.siteId), assetId: (body.assetId == null ? null : Ids.AssetId(body.assetId)), technicianId: (body.technicianId == null ? null : Ids.TechnicianId(body.technicianId)), technicianUserId: (body.technicianUserId == null ? null : body.technicianUserId), status: body.status, priority: body.priority, currency: body.currency, scheduledAt: (body.scheduledAt == null ? null : body.scheduledAt), startedAt: (body.startedAt == null ? null : body.startedAt), completedAt: (body.completedAt == null ? null : body.completedAt), resolutionNote: (body.resolutionNote == null ? null : body.resolutionNote) });
      await repo.save(created);
      c.get("log").info({ event: "aggregate_created", aggregate: "WorkOrder", id: created.id as string });
      recordDomainOperation("WorkOrder", "create");
      return c.json({ id: created.id as string }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/mine",
      tags: ["work_orders"],
      operationId: "mineWorkOrder",
      responses: {
        200: { description: "OK", content: { "application/json": { schema: WorkOrderListResponse } } },
      },
    }),
    async (c) => {
      const currentUser = (c as unknown as { get(k: "currentUser"): import("../auth/user-types").User }).get("currentUser");
      const result = await repo.mine(currentUser);
      return c.json(result.map((r) => repo.toWire(r)) as z.infer<typeof WorkOrderResponse>[], 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/across_all_tenants",
      tags: ["work_orders"],
      operationId: "acrossAllTenantsWorkOrder",
      responses: {
        200: { description: "OK", content: { "application/json": { schema: WorkOrderListResponse } } },
        403: { description: "Forbidden", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      const currentUser = (c as unknown as { get(k: "currentUser"): import("../auth/user-types").User }).get("currentUser");
      if (!(currentUser.role === "platformAdmin")) throw new ForbiddenError("Forbidden: find acrossAllTenants");
      const result = await repo.acrossAllTenants();
      return c.json(result.map((r) => repo.toWire(r)) as z.infer<typeof WorkOrderResponse>[], 200);
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
      method: "delete",
      path: "/{id}",
      tags: ["work_orders"],
      operationId: "destroyWorkOrder",
      request: { params: z.object({ id: z.string().uuid() }) },
      responses: {
        204: { description: "No Content" },
        404: { description: "Not Found", content: { "application/problem+json": { schema: ProblemDetails } } },
        409: { description: "Conflict", content: { "application/problem+json": { schema: ProblemDetails } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      await repo.getById(Ids.WorkOrderId(id));
      try {
        await repo.delete(Ids.WorkOrderId(id));
      } catch (err) {
        if (err && typeof err === "object" && ["23001", "23503"].includes(((err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code) as string)) {
          return c.body(JSON.stringify({ type: "about:blank", title: "Conflict", status: 409, detail: "WorkOrder is still referenced and cannot be deleted.", instance: c.req.path }), 409, { "content-type": "application/problem+json" });
        }
        throw err;
      }
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/{id}/assign_technician",
      tags: ["work_orders"],
      operationId: "assignTechnicianWorkOrder",
      request: {
        params: z.object({ id: z.string().uuid() }),
        body: { content: { "application/json": { schema: AssignTechnicianWorkOrderRequest } } },
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
      c.get("log").info({ event: "operation_invoked", aggregate: "WorkOrder", op: "assignTechnician", id });
      recordDomainOperation("WorkOrder", "assignTechnician");
      const currentUser = (c as unknown as { get(k: "currentUser"): import("../auth/user-types").User }).get("currentUser");
      const aggregate = await repo.getById(Ids.WorkOrderId(id));
      if (!(currentUser.role === "admin" || currentUser.role === "dispatcher")) throw new ForbiddenError("Forbidden: currentUser.role == \"admin\" || currentUser.role == \"dispatcher\"");
      aggregate.assignTechnician(Ids.TechnicianId(body.assignTo), body.assignedUserId, body.at);
      await repo.save(aggregate);
      return c.body(null, 204);
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
      aggregate.start();
      await repo.save(aggregate);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/{id}/add_line",
      tags: ["work_orders"],
      operationId: "addLineWorkOrder",
      request: {
        params: z.object({ id: z.string().uuid() }),
        body: { content: { "application/json": { schema: AddLineWorkOrderRequest } } },
      },
      responses: {
        204: { description: "No content" },
        400: { description: "Bad Request", content: { "application/problem+json": { schema: ProblemDetails } } },
        404: { description: "Not Found", content: { "application/problem+json": { schema: ProblemDetails } } },
        415: { description: "Unsupported Media Type", content: { "application/problem+json": { schema: ProblemDetails } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      requireJsonContentType(c);
      const body = c.req.valid("json");
      c.get("log").info({ event: "operation_invoked", aggregate: "WorkOrder", op: "addLine", id });
      recordDomainOperation("WorkOrder", "addLine");
      const aggregate = await repo.getById(Ids.WorkOrderId(id));
      aggregate.addLine(body.kind, body.description, (body.partId == null ? null : Ids.PartId(body.partId)), body.quantity, new Money(body.unitPrice.amount, body.unitPrice.currency));
      await repo.save(aggregate);
      return c.body(null, 204);
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
      aggregate.complete(body.note);
      await repo.save(aggregate);
      return c.body(null, 204);
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
      aggregate.cancel();
      await repo.save(aggregate);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/{id}/notify_customer",
      tags: ["work_orders"],
      operationId: "notifyCustomerWorkOrder",
      request: {
        params: z.object({ id: z.string().uuid() }),
        body: { content: { "application/json": { schema: NotifyCustomerWorkOrderRequest } } },
      },
      responses: {
        204: { description: "No content" },
        400: { description: "Bad Request", content: { "application/problem+json": { schema: ProblemDetails } } },
        404: { description: "Not Found", content: { "application/problem+json": { schema: ProblemDetails } } },
        415: { description: "Unsupported Media Type", content: { "application/problem+json": { schema: ProblemDetails } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      requireJsonContentType(c);
      const body = c.req.valid("json");
      c.get("log").info({ event: "operation_invoked", aggregate: "WorkOrder", op: "notifyCustomer", id });
      recordDomainOperation("WorkOrder", "notifyCustomer");
      const aggregate = await repo.getById(Ids.WorkOrderId(id));
      aggregate.notifyCustomer();
      await repo.save(aggregate);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/{id}/attach_photo",
      tags: ["work_orders"],
      operationId: "attachPhotoWorkOrder",
      request: {
        params: z.object({ id: z.string().uuid() }),
        body: { content: { "application/json": { schema: AttachPhotoWorkOrderRequest } } },
      },
      responses: {
        204: { description: "No content" },
        400: { description: "Bad Request", content: { "application/problem+json": { schema: ProblemDetails } } },
        404: { description: "Not Found", content: { "application/problem+json": { schema: ProblemDetails } } },
        415: { description: "Unsupported Media Type", content: { "application/problem+json": { schema: ProblemDetails } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      requireJsonContentType(c);
      const body = c.req.valid("json");
      c.get("log").info({ event: "operation_invoked", aggregate: "WorkOrder", op: "attachPhoto", id });
      recordDomainOperation("WorkOrder", "attachPhoto");
      const aggregate = await repo.getById(Ids.WorkOrderId(id));
      aggregate.attachPhoto(body.file, body.caption);
      await repo.save(aggregate);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/{id}/update",
      tags: ["work_orders"],
      operationId: "updateWorkOrder",
      request: {
        params: z.object({ id: z.string().uuid() }),
        body: { content: { "application/json": { schema: UpdateWorkOrderRequest } } },
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
      c.get("log").info({ event: "operation_invoked", aggregate: "WorkOrder", op: "update", id });
      recordDomainOperation("WorkOrder", "update");
      const aggregate = await repo.getById(Ids.WorkOrderId(id));
      const ifMatch = c.req.header("if-match");
      const expectedVersion = parseIfMatch(ifMatch, aggregate.version);
      aggregate.update(Ids.CustomerId(body.customerId), Ids.SiteId(body.siteId), (body.assetId == null ? null : Ids.AssetId(body.assetId)), (body.technicianId == null ? null : Ids.TechnicianId(body.technicianId)), (body.technicianUserId == null ? null : body.technicianUserId), body.status, body.priority, body.currency, (body.scheduledAt == null ? null : body.scheduledAt), (body.startedAt == null ? null : body.startedAt), (body.completedAt == null ? null : body.completedAt), (body.resolutionNote == null ? null : body.resolutionNote));
      await repo.save(aggregate, expectedVersion);
      return c.body(null, 204);
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
    const problem = (status: 403 | 404 | 409 | 422 | 500 | 501, title: string, detail: string) => c.body(JSON.stringify({ type: "about:blank", title, status, detail, instance: c.req.path }), status, { "content-type": "application/problem+json", "x-request-id": trace_id });
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
    if (err instanceof NotImplementedError) {
      c.get("log").error({ event: "internal_error", error: err.message, status: 501 });
      return problem(501, "Not Implemented", err.message);
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

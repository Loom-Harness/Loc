// Auto-generated.  Do not edit by hand.
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { ProblemDetails, frameworkProblemBody, newApp, parseIfMatch, requireJsonContentType, versionETag } from "./problem-details";
import { HTTPException } from "hono/http-exception";
import { recordDomainFault, recordDomainOperation } from "../obs/metrics";
import { Technician } from "../domain/technician";
import type { TechnicianRepository } from "../db/repositories/technician-repository";
import * as Ids from "../domain/ids";
import { DomainError, AggregateNotFoundError, DisallowedError, ForbiddenError, ExternHandlerError, ConcurrencyError } from "../domain/errors";


const CreateTechnicianRequest = z.object({
  userId: z.string().refine((s: string) => !s.includes("\u0000")),
  name: z.string().refine((s: string) => !s.includes("\u0000")),
  skills: z.array(z.string()),
  costRatePerHour: z.number(),
}).openapi("CreateTechnicianRequest");
const CreateTechnicianResponse = z.object({ id: z.string() }).openapi("CreateTechnicianResponse");

const UpdateTechnicianRequest = z.object({
  userId: z.string().refine((s: string) => !s.includes("\u0000")),
  name: z.string().refine((s: string) => !s.includes("\u0000")),
  skills: z.array(z.string()),
  costRatePerHour: z.number(),
}).openapi("UpdateTechnicianRequest");

const AllQuery = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  sort: z.enum(["id", "userId", "name", ""]).default("id"),
  dir: z.string().default("asc"),
}).openapi("AllQuery");
export const TechnicianResponse = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  skills: z.array(z.string()),
  costRatePerHour: z.number().nullable(),
  version: z.number().int().openapi({ format: "int32" }),
  display: z.string(),
}).openapi("TechnicianResponse");
export const TechnicianListResponse = z.array(TechnicianResponse).openapi("TechnicianListResponse");
export const TechnicianPaged = z.object({ items: z.array(TechnicianResponse), page: z.number().int(), pageSize: z.number().int(), total: z.number().int(), totalPages: z.number().int() }).openapi("TechnicianPaged");

export function technicianRoutes(repo: TechnicianRepository): OpenAPIHono {
  const app = newApp();

  app.openapi(
    createRoute({
      method: "post",
      path: "/",
      tags: ["technicians"],
      operationId: "createTechnician",
      request: {
        body: { content: { "application/json": { schema: CreateTechnicianRequest } } },
      },
      responses: {
        201: {
          description: "Created",
          content: { "application/json": { schema: CreateTechnicianResponse } },
        },
        400: { description: "Bad Request", content: { "application/problem+json": { schema: ProblemDetails } } },
        415: { description: "Unsupported Media Type", content: { "application/problem+json": { schema: ProblemDetails } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      requireJsonContentType(c);
      const body = c.req.valid("json");
      const created = Technician.create({ userId: body.userId, name: body.name, skills: body.skills.map((e: any) => e), costRatePerHour: body.costRatePerHour });
      await repo.save(created);
      c.get("log").info({ event: "aggregate_created", aggregate: "Technician", id: created.id as string });
      recordDomainOperation("Technician", "create");
      return c.json({ id: created.id as string }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/{id}",
      tags: ["technicians"],
      operationId: "getTechnicianById",
      request: { params: z.object({ id: z.string().uuid() }) },
      responses: {
        200: { description: "OK", content: { "application/json": { schema: TechnicianResponse } } },
        404: { description: "Not Found", content: { "application/problem+json": { schema: ProblemDetails } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const found = await repo.findById(Ids.TechnicianId(id));
      if (!found) throw new AggregateNotFoundError(`Technician ${id} not found`);
      const __maskUser = (c as unknown as { get(k: "currentUser"): import("../auth/user-types").User | undefined }).get("currentUser") ?? null;
      c.header("etag", versionETag(found.version));
      return c.json(repo.toWireMasked(found, __maskUser) as z.infer<typeof TechnicianResponse>, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/{id}",
      tags: ["technicians"],
      operationId: "destroyTechnician",
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
      await repo.getById(Ids.TechnicianId(id));
      try {
        await repo.delete(Ids.TechnicianId(id));
      } catch (err) {
        if (err && typeof err === "object" && ["23001", "23503"].includes(((err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code) as string)) {
          return c.body(JSON.stringify({ type: "about:blank", title: "Conflict", status: 409, detail: "Technician is still referenced and cannot be deleted.", instance: c.req.path }), 409, { "content-type": "application/problem+json" });
        }
        throw err;
      }
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/{id}/update",
      tags: ["technicians"],
      operationId: "updateTechnician",
      request: {
        params: z.object({ id: z.string().uuid() }),
        body: { content: { "application/json": { schema: UpdateTechnicianRequest } } },
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
      c.get("log").info({ event: "operation_invoked", aggregate: "Technician", op: "update", id });
      recordDomainOperation("Technician", "update");
      const aggregate = await repo.getById(Ids.TechnicianId(id));
      const ifMatch = c.req.header("if-match");
      const expectedVersion = parseIfMatch(ifMatch, aggregate.version);
      aggregate.update(body.userId, body.name, body.skills.map((e: any) => e), body.costRatePerHour);
      await repo.save(aggregate, expectedVersion);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["technicians"],
      operationId: "allTechnician",
      request: { query: AllQuery },
      responses: {
        200: { description: "OK", content: { "application/json": { schema: TechnicianPaged } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      const params = c.req.valid("query");
      const result = await repo.all(params.page, params.pageSize, params.sort, params.dir);
      const __maskUser = (c as unknown as { get(k: "currentUser"): import("../auth/user-types").User | undefined }).get("currentUser") ?? null;
      return c.json({ ...result, items: result.items.map((r) => repo.toWireMasked(r, __maskUser)) } as z.infer<typeof TechnicianPaged>, 200);
    },
  );

  app.onError((err, c) => {
    const trace_id = c.get("requestId") ?? "";
    const problem = (status: 403 | 404 | 409 | 422 | 500, title: string, detail: string) => c.body(JSON.stringify({ type: "about:blank", title, status, detail, instance: c.req.path }), status, { "content-type": "application/problem+json", "x-request-id": trace_id });
    if (err instanceof ForbiddenError) {
      c.get("log").warn({ event: "forbidden", aggregate: "Technician", message: err.message, status: 403 });
      recordDomainFault("forbidden");
      return problem(403, "Forbidden", err.message);
    }
    if (err instanceof DisallowedError) {
      c.get("log").warn({ event: "disallowed", aggregate: "Technician", message: err.message, status: 409 });
      recordDomainFault("disallowed");
      return problem(409, "Disallowed", err.message);
    }
    if (err instanceof DomainError) {
      c.get("log").warn({ event: "domain_error", aggregate: "Technician", message: err.message, status: 422 });
      recordDomainFault("domain_error");
      return problem(422, "Unprocessable Entity", err.message);
    }
    if (err instanceof AggregateNotFoundError) {
      c.get("log").warn({ event: "not_found", aggregate: "Technician", status: 404 });
      recordDomainFault("not_found");
      return problem(404, "Not Found", err.message);
    }
    if (err instanceof ConcurrencyError) {
      c.get("log").warn({ event: "conflict", aggregate: "Technician", message: err.message, status: 409 });
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

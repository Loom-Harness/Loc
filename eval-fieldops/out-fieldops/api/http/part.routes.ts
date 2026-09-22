// Auto-generated.  Do not edit by hand.
import { moneySchema } from "../lib/schemas.ts";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { ProblemDetails, frameworkProblemBody, newApp, parseIfMatch, requireJsonContentType, versionETag } from "./problem-details.ts";
import { HTTPException } from "hono/http-exception";
import { recordDomainFault, recordDomainOperation } from "../obs/metrics.ts";
import { Part } from "../domain/part.ts";
import type { PartRepository } from "../db/repositories/part-repository.ts";
import * as Ids from "../domain/ids.ts";
import { DomainError, AggregateNotFoundError, DisallowedError, ForbiddenError, ExternHandlerError, ConcurrencyError } from "../domain/errors.ts";


const CreatePartRequest = z.object({
  sku: z.string().refine((s: string) => !s.includes("\u0000")),
  binCode: z.string().refine((s: string) => !s.includes("\u0000")),
  onHand: z.number().int().openapi({ format: "int32" }).min(0, { message: "On Hand must be at least 0" }),
  unitPrice: moneySchema,
  currency: z.string().refine((s: string) => !s.includes("\u0000")),
}).openapi("CreatePartRequest");
const CreatePartResponse = z.object({ id: z.string() }).openapi("CreatePartResponse");

const ConsumePartRequest = z.object({
  qty: z.number().int().openapi({ format: "int32" }).min(1, { message: "Qty must be at least 1" }),
}).openapi("ConsumePartRequest");
const UpdatePartRequest = z.object({
  sku: z.string().refine((s: string) => !s.includes("\u0000")),
  binCode: z.string().refine((s: string) => !s.includes("\u0000")),
  onHand: z.number().int().openapi({ format: "int32" }).min(0, { message: "On Hand must be at least 0" }),
  unitPrice: moneySchema,
  currency: z.string().refine((s: string) => !s.includes("\u0000")),
}).openapi("UpdatePartRequest");

const AllQuery = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  sort: z.enum(["id", "sku", "binCode", "onHand", "unitPrice", "currency", ""]).default("id"),
  dir: z.string().default("asc"),
}).openapi("AllQuery");
export const PartResponse = z.object({
  id: z.string(),
  sku: z.string(),
  binCode: z.string(),
  onHand: z.number().int().openapi({ format: "int32" }),
  unitPrice: z.string(),
  currency: z.string(),
  version: z.number().int().openapi({ format: "int32" }),
  display: z.string(),
}).openapi("PartResponse");
export const PartListResponse = z.array(PartResponse).openapi("PartListResponse");
export const PartPaged = z.object({ items: z.array(PartResponse), page: z.number().int(), pageSize: z.number().int(), total: z.number().int(), totalPages: z.number().int() }).openapi("PartPaged");

export function partRoutes(repo: PartRepository): OpenAPIHono {
  const app = newApp();

  app.openapi(
    createRoute({
      method: "post",
      path: "/",
      tags: ["parts"],
      operationId: "createPart",
      request: {
        body: { content: { "application/json": { schema: CreatePartRequest } } },
      },
      responses: {
        201: {
          description: "Created",
          content: { "application/json": { schema: CreatePartResponse } },
        },
        400: { description: "Bad Request", content: { "application/problem+json": { schema: ProblemDetails } } },
        415: { description: "Unsupported Media Type", content: { "application/problem+json": { schema: ProblemDetails } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      requireJsonContentType(c);
      const body = c.req.valid("json");
      const created = Part.create({ sku: body.sku, binCode: body.binCode, onHand: body.onHand, unitPrice: body.unitPrice, currency: body.currency });
      await repo.save(created);
      c.get("log").info({ event: "aggregate_created", aggregate: "Part", id: created.id as string });
      recordDomainOperation("Part", "create");
      return c.json({ id: created.id as string }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/{id}",
      tags: ["parts"],
      operationId: "getPartById",
      request: { params: z.object({ id: z.string().uuid() }) },
      responses: {
        200: { description: "OK", content: { "application/json": { schema: PartResponse } } },
        404: { description: "Not Found", content: { "application/problem+json": { schema: ProblemDetails } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const found = await repo.findById(Ids.PartId(id));
      if (!found) throw new AggregateNotFoundError(`Part ${id} not found`);
      c.header("etag", versionETag(found.version));
      return c.json(repo.toWire(found) as z.infer<typeof PartResponse>, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/{id}",
      tags: ["parts"],
      operationId: "destroyPart",
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
      await repo.getById(Ids.PartId(id));
      try {
        await repo.delete(Ids.PartId(id));
      } catch (err) {
        if (err && typeof err === "object" && ["23001", "23503"].includes(((err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code) as string)) {
          return c.body(JSON.stringify({ type: "about:blank", title: "Conflict", status: 409, detail: "Part is still referenced and cannot be deleted.", instance: c.req.path }), 409, { "content-type": "application/problem+json" });
        }
        throw err;
      }
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/{id}/consume",
      tags: ["parts"],
      operationId: "consumePart",
      request: {
        params: z.object({ id: z.string().uuid() }),
        body: { content: { "application/json": { schema: ConsumePartRequest } } },
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
      c.get("log").info({ event: "operation_invoked", aggregate: "Part", op: "consume", id });
      recordDomainOperation("Part", "consume");
      const aggregate = await repo.getById(Ids.PartId(id));
      aggregate.consume(body.qty);
      await repo.save(aggregate);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/{id}/update",
      tags: ["parts"],
      operationId: "updatePart",
      request: {
        params: z.object({ id: z.string().uuid() }),
        body: { content: { "application/json": { schema: UpdatePartRequest } } },
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
      c.get("log").info({ event: "operation_invoked", aggregate: "Part", op: "update", id });
      recordDomainOperation("Part", "update");
      const aggregate = await repo.getById(Ids.PartId(id));
      const ifMatch = c.req.header("if-match");
      const expectedVersion = parseIfMatch(ifMatch, aggregate.version);
      aggregate.update(body.sku, body.binCode, body.onHand, body.unitPrice, body.currency);
      await repo.save(aggregate, expectedVersion);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["parts"],
      operationId: "allPart",
      request: { query: AllQuery },
      responses: {
        200: { description: "OK", content: { "application/json": { schema: PartPaged } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      const params = c.req.valid("query");
      const result = await repo.all(params.page, params.pageSize, params.sort, params.dir);
      return c.json({ ...result, items: result.items.map((r) => repo.toWire(r)) } as z.infer<typeof PartPaged>, 200);
    },
  );

  app.onError((err, c) => {
    const trace_id = c.get("requestId") ?? "";
    const problem = (status: 403 | 404 | 409 | 422 | 500, title: string, detail: string) => c.body(JSON.stringify({ type: "about:blank", title, status, detail, instance: c.req.path }), status, { "content-type": "application/problem+json", "x-request-id": trace_id });
    if (err instanceof ForbiddenError) {
      c.get("log").warn({ event: "forbidden", aggregate: "Part", message: err.message, status: 403 });
      recordDomainFault("forbidden");
      return problem(403, "Forbidden", err.message);
    }
    if (err instanceof DisallowedError) {
      c.get("log").warn({ event: "disallowed", aggregate: "Part", message: err.message, status: 409 });
      recordDomainFault("disallowed");
      return problem(409, "Disallowed", err.message);
    }
    if (err instanceof DomainError) {
      c.get("log").warn({ event: "domain_error", aggregate: "Part", message: err.message, status: 422 });
      recordDomainFault("domain_error");
      return problem(422, "Unprocessable Entity", err.message);
    }
    if (err instanceof AggregateNotFoundError) {
      c.get("log").warn({ event: "not_found", aggregate: "Part", status: 404 });
      recordDomainFault("not_found");
      return problem(404, "Not Found", err.message);
    }
    if (err && typeof err === "object" && (((err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code) === "23505")) {
      c.get("log").warn({ event: "disallowed", aggregate: "Part", message: (err as { constraint?: string }).constraint ?? (err as { cause?: { constraint?: string } }).cause?.constraint ?? "unique_violation", status: 409 });
      recordDomainFault("disallowed");
      return problem(409, "Conflict", `A Part with these values already exists.`);
    }
    if (err instanceof ConcurrencyError) {
      c.get("log").warn({ event: "conflict", aggregate: "Part", message: err.message, status: 409 });
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
//# sourceMappingURL=part.routes.ts.map

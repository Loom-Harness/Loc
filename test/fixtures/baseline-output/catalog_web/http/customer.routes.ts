// Auto-generated.  Do not edit by hand.
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { ProblemDetails, UuidString, frameworkProblemBody, newApp, problemParams, parseIfMatch, requireJsonContentType, versionETag } from "./problem-details";
import { HTTPException } from "hono/http-exception";
import { recordDomainFault, recordDomainOperation } from "../obs/metrics";
import { Customer } from "../domain/customer";
import type { CustomerRepository } from "../db/repositories/customer-repository";
import * as Ids from "../domain/ids";
import { DomainError, AggregateNotFoundError, DisallowedError, ForbiddenError, ExternHandlerError, ConcurrencyError } from "../domain/errors";


const CreateCustomerRequest = z.object({
  username: z.string().refine((v: any) => [...v].length >= 3, { message: "Username must be 3 to 32 characters", params: { loomCode: "field.min-length", loomValues: {"min":3} } }).refine((v: any) => [...v].length <= 32, { message: "Username must be 3 to 32 characters", params: { loomCode: "field.max-length", loomValues: {"max":32} } }).openapi({ minLength: 3, maxLength: 32 }).refine((s: string) => !s.includes("\u0000")),
  email: z.string().refine((s: string) => !s.includes("\u0000")),
  age: z.number().int().openapi({ format: "int32" }).refine((v: any) => v >= 18, { message: "Age must be between 18 and 150", params: { loomCode: "field.min", loomValues: {"min":18} } }).refine((v: any) => v <= 150, { message: "Age must be between 18 and 150", params: { loomCode: "field.max", loomValues: {"max":150} } }).openapi({ minimum: 18, maximum: 150 }),
}).openapi("CreateCustomerRequest").refine((data: any) => data.username !== data.email, { path: ["username"], message: "Business rule violated", params: { loomCode: "problem.domain-floor" } }).refine((data: any) => /^[^@]+@[^@]+\.[^@]+$/.test(data.email) && [...data.email].length <= 120, { path: ["email"], message: "Business rule violated", params: { loomCode: "problem.domain-floor" } });
const CreateCustomerResponse = z.object({ id: z.string() }).openapi("CreateCustomerResponse");

const UpdateCustomerRequest = z.object({
  username: z.string().refine((v: any) => [...v].length >= 3, { message: "Username must be 3 to 32 characters", params: { loomCode: "field.min-length", loomValues: {"min":3} } }).refine((v: any) => [...v].length <= 32, { message: "Username must be 3 to 32 characters", params: { loomCode: "field.max-length", loomValues: {"max":32} } }).openapi({ minLength: 3, maxLength: 32 }).refine((s: string) => !s.includes("\u0000")).optional(),
  email: z.string().refine((s: string) => !s.includes("\u0000")).optional(),
  age: z.number().int().openapi({ format: "int32" }).refine((v: any) => v >= 18, { message: "Age must be between 18 and 150", params: { loomCode: "field.min", loomValues: {"min":18} } }).refine((v: any) => v <= 150, { message: "Age must be between 18 and 150", params: { loomCode: "field.max", loomValues: {"max":150} } }).openapi({ minimum: 18, maximum: 150 }).optional(),
}).openapi("UpdateCustomerRequest").refine((data: any) => data.username === undefined || data.email === undefined || (data.username !== data.email), { path: ["username"], message: "Business rule violated", params: { loomCode: "problem.domain-floor" } }).refine((data: any) => data.email === undefined || (/^[^@]+@[^@]+\.[^@]+$/.test(data.email) && [...data.email].length <= 120), { path: ["email"], message: "Business rule violated", params: { loomCode: "problem.domain-floor" } });

const AllQuery = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  sort: z.enum(["id", "username", "email", "age", ""]).default("id"),
  dir: z.string().default("asc"),
}).openapi("AllQuery");
export const CustomerResponse = z.object({
  id: z.string(),
  username: z.string(),
  email: z.string(),
  age: z.number().int().openapi({ format: "int32" }),
  rowVersion: z.number().int().openapi({ format: "int32" }),
  display: z.string(),
}).openapi("CustomerResponse");
export const CustomerListResponse = z.array(CustomerResponse).openapi("CustomerListResponse");
export const CustomerPaged = z.object({ items: z.array(CustomerResponse), page: z.number().int(), pageSize: z.number().int(), total: z.number().int(), totalPages: z.number().int() }).openapi("CustomerPaged");

export function customerRoutes(repo: CustomerRepository): OpenAPIHono {
  const app = newApp();

  app.openapi(
    createRoute({
      method: "post",
      path: "/",
      tags: ["customers"],
      operationId: "createCustomer",
      request: {
        body: { content: { "application/json": { schema: CreateCustomerRequest } } },
      },
      responses: {
        201: {
          description: "Created",
          content: { "application/json": { schema: CreateCustomerResponse } },
        },
        400: { description: "Bad Request", content: { "application/problem+json": { schema: ProblemDetails } } },
        415: { description: "Unsupported Media Type", content: { "application/problem+json": { schema: ProblemDetails } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      requireJsonContentType(c);
      const body = c.req.valid("json");
      const created = Customer.create({ username: body.username, email: body.email, age: body.age });
      await repo.save(created);
      c.get("log").info({ event: "aggregate_created", aggregate: "Customer", id: created.id as string });
      recordDomainOperation("Customer", "create");
      return c.json({ id: created.id as string }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/{id}",
      tags: ["customers"],
      operationId: "getCustomerById",
      request: { params: z.object({ id: UuidString }) },
      responses: {
        200: { description: "OK", content: { "application/json": { schema: CustomerResponse } } },
        404: { description: "Not Found", content: { "application/problem+json": { schema: ProblemDetails } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const found = await repo.findById(Ids.CustomerId(id));
      if (!found) throw new AggregateNotFoundError(`Customer ${id} not found`);
      c.header("etag", versionETag(found.rowVersion));
      return c.json(repo.toWire(found) as z.infer<typeof CustomerResponse>, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/{id}",
      tags: ["customers"],
      operationId: "destroyCustomer",
      request: { params: z.object({ id: UuidString }) },
      responses: {
        204: { description: "No Content" },
        404: { description: "Not Found", content: { "application/problem+json": { schema: ProblemDetails } } },
        409: { description: "Conflict", content: { "application/problem+json": { schema: ProblemDetails } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const __loaded = await repo.getById(Ids.CustomerId(id));
      const ifMatch = c.req.header("if-match");
      const expectedVersion = parseIfMatch(ifMatch, __loaded.rowVersion);
      if (expectedVersion !== __loaded.rowVersion) throw new ConcurrencyError("Customer", id);
      try {
        await repo.delete(Ids.CustomerId(id));
      } catch (err) {
        if (err && typeof err === "object" && ["23001", "23503"].includes(((err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code) as string)) {
          return c.body(JSON.stringify({ type: "about:blank", title: "Conflict", status: 409, detail: "Customer is still referenced and cannot be deleted.", instance: c.req.path, code: "problem.referenced-in-use", ...problemParams("problem.referenced-in-use", c.req.path) }), 409, { "content-type": "application/problem+json" });
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
      tags: ["customers"],
      operationId: "updateCustomer",
      request: {
        params: z.object({ id: UuidString }),
        body: { content: { "application/json": { schema: UpdateCustomerRequest } } },
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
      c.get("log").info({ event: "operation_invoked", aggregate: "Customer", op: "update", id });
      recordDomainOperation("Customer", "update");
      const aggregate = await repo.getById(Ids.CustomerId(id));
      const ifMatch = c.req.header("if-match");
      const expectedVersion = parseIfMatch(ifMatch, aggregate.rowVersion);
      aggregate.update((body.username === undefined ? aggregate.username : body.username), (body.email === undefined ? aggregate.email : body.email), (body.age === undefined ? aggregate.age : body.age));
      await repo.save(aggregate, expectedVersion);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["customers"],
      operationId: "allCustomer",
      request: { query: AllQuery },
      responses: {
        200: { description: "OK", content: { "application/json": { schema: CustomerPaged } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      const params = c.req.valid("query");
      const result = await repo.all(params.page, params.pageSize, params.sort, params.dir);
      return c.json({ ...result, items: result.items.map((r) => repo.toWire(r)) } as z.infer<typeof CustomerPaged>, 200);
    },
  );

  app.onError((err, c) => {
    const trace_id = c.get("requestId") ?? "";
    const problem = (status: 403 | 404 | 409 | 422 | 500, title: string, detail: string, code: string, params?: Record<string, unknown>) => c.body(JSON.stringify({ type: "about:blank", title, status, detail, instance: c.req.path, code, ...problemParams(code, c.req.path, params) }), status, { "content-type": "application/problem+json", "x-request-id": trace_id });
    if (err instanceof ForbiddenError) {
      c.get("log").warn({ event: "forbidden", aggregate: "Customer", message: err.message, status: 403 });
      recordDomainFault("forbidden");
      return problem(403, "Forbidden", err.detail, "problem.forbidden");
    }
    if (err instanceof DisallowedError) {
      c.get("log").warn({ event: "disallowed", aggregate: "Customer", message: err.message, status: 409 });
      recordDomainFault("disallowed");
      return problem(409, "Disallowed", err.message, "problem.state-gate");
    }
    if (err instanceof DomainError) {
      c.get("log").warn({ event: "domain_error", aggregate: "Customer", message: err.message, status: 422 });
      recordDomainFault("domain_error");
      return problem(422, "Unprocessable Entity", err.message, err.problemCode);
    }
    if (err instanceof AggregateNotFoundError) {
      c.get("log").warn({ event: "not_found", aggregate: "Customer", status: 404 });
      recordDomainFault("not_found");
      return problem(404, "Not Found", err.message, "problem.not-found");
    }
    if (err instanceof ConcurrencyError) {
      c.get("log").warn({ event: "conflict", aggregate: "Customer", message: err.message, status: 409 });
      recordDomainFault("conflict");
      return problem(409, "Conflict", err.message, "problem.version-conflict");
    }
    if (err instanceof ExternHandlerError) {
      c.get("log").error({ event: "extern_handler_threw", aggregate: err.aggName, op: err.opName, error: err.message });
      return problem(500, "Internal Server Error", "internal", "problem.internal", { requestId: trace_id });
    }
    if (err instanceof HTTPException) {
      c.get("log").warn({ event: "client_error", error: err.message, status: err.status });
      return c.body(frameworkProblemBody(err.status, err.message, c.req.path), err.status, { "content-type": "application/problem+json", "x-request-id": trace_id });
    }
    c.get("log").error({ event: "internal_error", error: err instanceof Error ? err.message : String(err), status: 500 });
    return problem(500, "Internal Server Error", "internal", "problem.internal", { requestId: trace_id });
  });

  return app;
}

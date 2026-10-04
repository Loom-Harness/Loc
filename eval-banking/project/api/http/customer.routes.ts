// Auto-generated.  Do not edit by hand.
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { ProblemDetails, UuidString, frameworkProblemBody, newApp, requireJsonContentType, versionETag, domainFloorProblem } from "./problem-details";
import { HTTPException } from "hono/http-exception";
import { recordDomainFault, recordDomainOperation } from "../obs/metrics";
import { Customer } from "../domain/customer";
import type { CustomerRepository } from "../db/repositories/customer-repository";
import * as Ids from "../domain/ids";
import { DomainError, AggregateNotFoundError, DisallowedError, ForbiddenError, ExternHandlerError, ConcurrencyError } from "../domain/errors";


const CreateCustomerRequest = z.object({
  firstName: z.string().refine((s: string) => !s.includes("\u0000")),
  lastName: z.string().refine((s: string) => !s.includes("\u0000")),
  email: z.string().refine((s: string) => !s.includes("\u0000")),
}).openapi("CreateCustomerRequest").refine((data: any) => data.email.includes("@"), { path: ["email"], message: "Invariant violated: email.contains(\"@\")" });
const CreateCustomerResponse = z.object({ id: z.string() }).openapi("CreateCustomerResponse");

const ChangeEmailCustomerRequest = z.object({
  newEmail: z.string().refine((s: string) => !s.includes("\u0000")),
}).openapi("ChangeEmailCustomerRequest").refine((data: any) => data.newEmail.includes("@"), { path: ["newEmail"], message: "Invariant violated: newEmail.contains(\"@\")" });

export const CustomerResponse = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  version: z.number().int().openapi({ format: "int32" }),
  display: z.string(),
}).openapi("CustomerResponse");
export const CustomerListResponse = z.array(CustomerResponse).openapi("CustomerListResponse");

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
        403: { description: "Forbidden", content: { "application/problem+json": { schema: ProblemDetails } } },
        415: { description: "Unsupported Media Type", content: { "application/problem+json": { schema: ProblemDetails } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      requireJsonContentType(c);
      const body = c.req.valid("json");
      const currentUser = (c as unknown as { get(k: "currentUser"): import("../auth/user-types").User }).get("currentUser");
      if (!(currentUser.role === "teller" || currentUser.role === "compliance")) throw new ForbiddenError("Forbidden: currentUser.role == \"teller\" || currentUser.role == \"compliance\"");
      const created = Customer.create({ firstName: body.firstName, lastName: body.lastName, email: body.email });
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
      c.header("etag", versionETag(found.version));
      return c.json(repo.toWire(found) as z.infer<typeof CustomerResponse>, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/{id}/change_email",
      tags: ["customers"],
      operationId: "changeEmailCustomer",
      request: {
        params: z.object({ id: UuidString }),
        body: { content: { "application/json": { schema: ChangeEmailCustomerRequest } } },
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
      c.get("log").info({ event: "operation_invoked", aggregate: "Customer", op: "changeEmail", id });
      recordDomainOperation("Customer", "changeEmail");
      const currentUser = (c as unknown as { get(k: "currentUser"): import("../auth/user-types").User }).get("currentUser");
      const aggregate = await repo.getById(Ids.CustomerId(id));
      if (!(currentUser.role === "teller" || currentUser.role === "compliance" || currentUser.customerId === aggregate.id)) throw new ForbiddenError("Forbidden: IsStaff() || currentUser.customerId == id");
      aggregate.changeEmail(body.newEmail);
      await repo.save(aggregate);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["customers"],
      operationId: "allCustomer",
      responses: {
        200: { description: "OK", content: { "application/json": { schema: CustomerListResponse } } },
        403: { description: "Forbidden", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      const currentUser = (c as unknown as { get(k: "currentUser"): import("../auth/user-types").User }).get("currentUser");
      if (!(currentUser.role === "teller" || currentUser.role === "compliance")) throw new ForbiddenError("Forbidden: find all");
      const result = await repo.all();
      return c.json(result.map((r) => repo.toWire(r)) as z.infer<typeof CustomerResponse>[], 200);
    },
  );

  app.onError((err, c) => {
    const trace_id = c.get("requestId") ?? "";
    const problem = (status: 403 | 404 | 409 | 422 | 500, title: string, detail: string) => c.body(JSON.stringify({ type: "about:blank", title, status, detail, instance: c.req.path }), status, { "content-type": "application/problem+json", "x-request-id": trace_id });
    if (err instanceof ForbiddenError) {
      c.get("log").warn({ event: "forbidden", aggregate: "Customer", message: err.message, status: 403 });
      recordDomainFault("forbidden");
      return problem(403, "Forbidden", err.message);
    }
    if (err instanceof DisallowedError) {
      c.get("log").warn({ event: "disallowed", aggregate: "Customer", message: err.message, status: 409 });
      recordDomainFault("disallowed");
      return problem(409, "Disallowed", err.message);
    }
    if (err instanceof DomainError) {
      c.get("log").warn({ event: "domain_error", aggregate: "Customer", message: err.message, status: 422 });
      recordDomainFault("domain_error");
      return domainFloorProblem(c, err, 422, "Unprocessable Entity") ?? problem(422, "Unprocessable Entity", err.message);
    }
    if (err instanceof AggregateNotFoundError) {
      c.get("log").warn({ event: "not_found", aggregate: "Customer", status: 404 });
      recordDomainFault("not_found");
      return problem(404, "Not Found", err.message);
    }
    if (err instanceof ConcurrencyError) {
      c.get("log").warn({ event: "conflict", aggregate: "Customer", message: err.message, status: 409 });
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

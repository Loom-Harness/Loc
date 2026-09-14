// Auto-generated.  Do not edit by hand.
import { moneySchema } from "../lib/schemas.ts";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { ProblemDetails, frameworkProblemBody, newApp, requireJsonContentType, versionETag } from "./problem-details.ts";
import { HTTPException } from "hono/http-exception";
import { recordDomainFault, recordDomainOperation } from "../obs/metrics.ts";
import { Invoice } from "../domain/invoice.ts";
import type { InvoiceRepository } from "../db/repositories/invoice-repository.ts";
import * as Ids from "../domain/ids.ts";
import { DomainError, AggregateNotFoundError, DisallowedError, ForbiddenError, ExternHandlerError, ConcurrencyError } from "../domain/errors.ts";


const IssueInvoiceRequest = z.object({
}).openapi("IssueInvoiceRequest");

const AllQuery = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  sort: z.enum(["id", "amount", "currency", "createdAt", "updatedAt", "createdBy", "updatedBy", ""]).default("id"),
  dir: z.string().default("asc"),
}).openapi("AllQuery");
export const InvoiceResponse = z.object({
  id: z.string(),
  workOrderId: z.string(),
  issuedAt: z.string().nullish(),
  amount: z.string(),
  currency: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: z.string(),
  updatedBy: z.string(),
  version: z.number().int().openapi({ format: "int32" }),
  issued: z.boolean(),
  display: z.string(),
}).openapi("InvoiceResponse");
export const InvoiceListResponse = z.array(InvoiceResponse).openapi("InvoiceListResponse");
export const InvoicePaged = z.object({ items: z.array(InvoiceResponse), page: z.number().int(), pageSize: z.number().int(), total: z.number().int(), totalPages: z.number().int() }).openapi("InvoicePaged");

export function invoiceRoutes(repo: InvoiceRepository): OpenAPIHono {
  const app = newApp();

  app.openapi(
    createRoute({
      method: "get",
      path: "/{id}",
      tags: ["invoices"],
      operationId: "getInvoiceById",
      request: { params: z.object({ id: z.string().uuid() }) },
      responses: {
        200: { description: "OK", content: { "application/json": { schema: InvoiceResponse } } },
        404: { description: "Not Found", content: { "application/problem+json": { schema: ProblemDetails } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const found = await repo.findById(Ids.InvoiceId(id));
      if (!found) throw new AggregateNotFoundError(`Invoice ${id} not found`);
      c.header("etag", versionETag(found.version));
      return c.json(repo.toWire(found) as z.infer<typeof InvoiceResponse>, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/{id}/issue",
      tags: ["invoices"],
      operationId: "issueInvoice",
      request: {
        params: z.object({ id: z.string().uuid() }),
        body: { content: { "application/json": { schema: IssueInvoiceRequest } } },
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
      c.get("log").info({ event: "operation_invoked", aggregate: "Invoice", op: "issue", id });
      recordDomainOperation("Invoice", "issue");
      const aggregate = await repo.getById(Ids.InvoiceId(id));
      if (!(aggregate.issuedAt === null)) throw new DisallowedError("operation 'issue' is not allowed in the current state of Invoice.");
      aggregate.issue();
      await repo.save(aggregate);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/{id}/can_issue",
      tags: ["invoices"],
      operationId: "can_issueInvoice",
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
      const aggregate = await repo.getById(Ids.InvoiceId(id));
      return c.json({ allowed: aggregate.issuedAt === null }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["invoices"],
      operationId: "allInvoice",
      request: { query: AllQuery },
      responses: {
        200: { description: "OK", content: { "application/json": { schema: InvoicePaged } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      const params = c.req.valid("query");
      const result = await repo.all(params.page, params.pageSize, params.sort, params.dir);
      return c.json({ ...result, items: result.items.map((r) => repo.toWire(r)) } as z.infer<typeof InvoicePaged>, 200);
    },
  );

  app.onError((err, c) => {
    const trace_id = c.get("requestId") ?? "";
    const problem = (status: 403 | 404 | 409 | 422 | 500, title: string, detail: string) => c.body(JSON.stringify({ type: "about:blank", title, status, detail, instance: c.req.path }), status, { "content-type": "application/problem+json", "x-request-id": trace_id });
    if (err instanceof ForbiddenError) {
      c.get("log").warn({ event: "forbidden", aggregate: "Invoice", message: err.message, status: 403 });
      recordDomainFault("forbidden");
      return problem(403, "Forbidden", err.message);
    }
    if (err instanceof DisallowedError) {
      c.get("log").warn({ event: "disallowed", aggregate: "Invoice", message: err.message, status: 409 });
      recordDomainFault("disallowed");
      return problem(409, "Disallowed", err.message);
    }
    if (err instanceof DomainError) {
      c.get("log").warn({ event: "domain_error", aggregate: "Invoice", message: err.message, status: 422 });
      recordDomainFault("domain_error");
      return problem(422, "Unprocessable Entity", err.message);
    }
    if (err instanceof AggregateNotFoundError) {
      c.get("log").warn({ event: "not_found", aggregate: "Invoice", status: 404 });
      recordDomainFault("not_found");
      return problem(404, "Not Found", err.message);
    }
    if (err && typeof err === "object" && (((err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code) === "23503")) {
      c.get("log").warn({ event: "domain_error", aggregate: "Invoice", message: "The request references a record that does not exist.", status: 422 });
      recordDomainFault("domain_error");
      return problem(422, "Unprocessable Entity", "The request references a record that does not exist.");
    }
    if (err instanceof ConcurrencyError) {
      c.get("log").warn({ event: "conflict", aggregate: "Invoice", message: err.message, status: 409 });
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
//# sourceMappingURL=invoice.routes.ts.map

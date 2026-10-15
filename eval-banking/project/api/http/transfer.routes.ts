// Auto-generated.  Do not edit by hand.
import { moneySchema } from "../lib/schemas";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { ProblemDetails, UuidString, frameworkProblemBody, newApp, requireJsonContentType, versionETag, domainFloorProblem } from "./problem-details";
import { HTTPException } from "hono/http-exception";
import { recordDomainFault, recordDomainOperation } from "../obs/metrics";
import { Transfer } from "../domain/transfer";
import type { TransferRepository } from "../db/repositories/transfer-repository";
import * as Ids from "../domain/ids";
import { DomainError, AggregateNotFoundError, DisallowedError, ForbiddenError, ExternHandlerError, ConcurrencyError } from "../domain/errors";

const TransferStatusSchema = z.enum(["Pending", "Completed", "Rejected"]).openapi("TransferStatus");

const MarkCompletedTransferRequest = z.object({
}).openapi("MarkCompletedTransferRequest");
const RejectTransferRequest = z.object({
  reason: z.string().refine((s: string) => !s.includes("\u0000")),
}).openapi("RejectTransferRequest");

export const TransferResponse = z.object({
  id: z.string(),
  reference: z.string(),
  source: z.string(),
  target: z.string(),
  amount: z.string(),
  status: TransferStatusSchema,
  requestedBy: z.string(),
  requestedAt: z.string(),
  decidedBy: z.string().nullish(),
  version: z.number().int().openapi({ format: "int32" }),
  display: z.string(),
}).openapi("TransferResponse");
export const TransferListResponse = z.array(TransferResponse).openapi("TransferListResponse");

export function transferRoutes(repo: TransferRepository): OpenAPIHono {
  const app = newApp();

  // A STATIC sub-path is captured by the sibling `/{id}` route under any
  // verb it does not itself serve, and the param validator then answers 422
  // for a path that has no such method at all.  405 is the honest answer and
  // the only one that can carry an `Allow` the caller can act on (RFC 9110
  // §15.5.6).  Runs BEFORE the param validator, which is why it is a
  // middleware; registered under method ALL, so the root router's
  // method probe (http/index.ts) is unaffected.
  const staticSubpathMethods: Record<string, string[]> = { pending: ["GET"] };
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
      method: "get",
      path: "/pending",
      tags: ["transfers"],
      operationId: "pendingTransfer",
      responses: {
        200: { description: "OK", content: { "application/json": { schema: TransferListResponse } } },
        403: { description: "Forbidden", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      const currentUser = (c as unknown as { get(k: "currentUser"): import("../auth/user-types").User }).get("currentUser");
      if (!((currentUser.permissions).includes("retail.transfersApprove"))) throw new ForbiddenError("Forbidden: find pending");
      const result = await repo.pending();
      return c.json(result.map((r) => repo.toWire(r)) as z.infer<typeof TransferResponse>[], 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/{id}",
      tags: ["transfers"],
      operationId: "getTransferById",
      request: { params: z.object({ id: UuidString }) },
      responses: {
        200: { description: "OK", content: { "application/json": { schema: TransferResponse } } },
        404: { description: "Not Found", content: { "application/problem+json": { schema: ProblemDetails } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const found = await repo.findById(Ids.TransferId(id));
      if (!found) throw new AggregateNotFoundError(`Transfer ${id} not found`);
      c.header("etag", versionETag(found.version));
      return c.json(repo.toWire(found) as z.infer<typeof TransferResponse>, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/{id}/mark_completed",
      tags: ["transfers"],
      operationId: "markCompletedTransfer",
      request: {
        params: z.object({ id: UuidString }),
        body: { content: { "application/json": { schema: MarkCompletedTransferRequest } } },
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
      c.get("log").info({ event: "operation_invoked", aggregate: "Transfer", op: "markCompleted", id });
      recordDomainOperation("Transfer", "markCompleted");
      const aggregate = await repo.getById(Ids.TransferId(id));
      if (!(true)) throw new ForbiddenError("Forbidden: true");
      aggregate.markCompleted();
      await repo.save(aggregate);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/{id}/reject",
      tags: ["transfers"],
      operationId: "rejectTransfer",
      request: {
        params: z.object({ id: UuidString }),
        body: { content: { "application/json": { schema: RejectTransferRequest } } },
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
      c.get("log").info({ event: "operation_invoked", aggregate: "Transfer", op: "reject", id });
      recordDomainOperation("Transfer", "reject");
      const currentUser = (c as unknown as { get(k: "currentUser"): import("../auth/user-types").User }).get("currentUser");
      const aggregate = await repo.getById(Ids.TransferId(id));
      if (!((currentUser.permissions).includes("retail.transfersApprove"))) throw new ForbiddenError("Forbidden: currentUser.permissions.contains(permissions.transfersApprove)");
      aggregate.reject(body.reason, currentUser);
      await repo.save(aggregate);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["transfers"],
      operationId: "allTransfer",
      responses: {
        200: { description: "OK", content: { "application/json": { schema: TransferListResponse } } },
        403: { description: "Forbidden", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      const currentUser = (c as unknown as { get(k: "currentUser"): import("../auth/user-types").User }).get("currentUser");
      if (!(currentUser.role === "teller" || currentUser.role === "compliance")) throw new ForbiddenError("Forbidden: find all");
      const result = await repo.all();
      return c.json(result.map((r) => repo.toWire(r)) as z.infer<typeof TransferResponse>[], 200);
    },
  );

  app.onError((err, c) => {
    const trace_id = c.get("requestId") ?? "";
    const problem = (status: 403 | 404 | 409 | 422 | 500, title: string, detail: string) => c.body(JSON.stringify({ type: "about:blank", title, status, detail, instance: c.req.path }), status, { "content-type": "application/problem+json", "x-request-id": trace_id });
    if (err instanceof ForbiddenError) {
      c.get("log").warn({ event: "forbidden", aggregate: "Transfer", message: err.message, status: 403 });
      recordDomainFault("forbidden");
      return problem(403, "Forbidden", err.message);
    }
    if (err instanceof DisallowedError) {
      c.get("log").warn({ event: "disallowed", aggregate: "Transfer", message: err.message, status: 409 });
      recordDomainFault("disallowed");
      return problem(409, "Disallowed", err.message);
    }
    if (err instanceof DomainError) {
      c.get("log").warn({ event: "domain_error", aggregate: "Transfer", message: err.message, status: 422 });
      recordDomainFault("domain_error");
      return domainFloorProblem(c, err, 422, "Unprocessable Entity") ?? problem(422, "Unprocessable Entity", err.message);
    }
    if (err instanceof AggregateNotFoundError) {
      c.get("log").warn({ event: "not_found", aggregate: "Transfer", status: 404 });
      recordDomainFault("not_found");
      return problem(404, "Not Found", err.message);
    }
    if (err && typeof err === "object" && (((err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code) === "23503")) {
      c.get("log").warn({ event: "domain_error", aggregate: "Transfer", message: "The request references a record that does not exist.", status: 422 });
      recordDomainFault("domain_error");
      return problem(422, "Unprocessable Entity", "The request references a record that does not exist.");
    }
    if (err && typeof err === "object" && (((err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code) === "23505")) {
      c.get("log").warn({ event: "disallowed", aggregate: "Transfer", message: (err as { constraint?: string }).constraint ?? (err as { cause?: { constraint?: string } }).cause?.constraint ?? "unique_violation", status: 409 });
      recordDomainFault("disallowed");
      return problem(409, "Conflict", `A Transfer with these values already exists.`);
    }
    if (err instanceof ConcurrencyError) {
      c.get("log").warn({ event: "conflict", aggregate: "Transfer", message: err.message, status: 409 });
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

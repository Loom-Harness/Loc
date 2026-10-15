// Auto-generated.  Do not edit by hand.
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { ProblemDetails, UuidString, frameworkProblemBody, newApp, versionETag, domainFloorProblem } from "./problem-details";
import { HTTPException } from "hono/http-exception";
import { recordDomainFault, recordDomainOperation } from "../obs/metrics";
import { InterestRun } from "../domain/interestRun";
import type { InterestRunRepository } from "../db/repositories/interestRun-repository";
import * as Ids from "../domain/ids";
import { DomainError, AggregateNotFoundError, DisallowedError, ForbiddenError, ExternHandlerError, ConcurrencyError } from "../domain/errors";



export const InterestRunResponse = z.object({
  id: z.string(),
  startedAt: z.string(),
  version: z.number().int().openapi({ format: "int32" }),
}).openapi("InterestRunResponse");
export const InterestRunListResponse = z.array(InterestRunResponse).openapi("InterestRunListResponse");

export function interestRunRoutes(repo: InterestRunRepository): OpenAPIHono {
  const app = newApp();

  app.openapi(
    createRoute({
      method: "get",
      path: "/{id}",
      tags: ["interest_runs"],
      operationId: "getInterestRunById",
      request: { params: z.object({ id: UuidString }) },
      responses: {
        200: { description: "OK", content: { "application/json": { schema: InterestRunResponse } } },
        404: { description: "Not Found", content: { "application/problem+json": { schema: ProblemDetails } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const found = await repo.findById(Ids.InterestRunId(id));
      if (!found) throw new AggregateNotFoundError(`InterestRun ${id} not found`);
      c.header("etag", versionETag(found.version));
      return c.json(repo.toWire(found) as z.infer<typeof InterestRunResponse>, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["interest_runs"],
      operationId: "allInterestRun",
      responses: {
        200: { description: "OK", content: { "application/json": { schema: InterestRunListResponse } } },
        403: { description: "Forbidden", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      const currentUser = (c as unknown as { get(k: "currentUser"): import("../auth/user-types").User }).get("currentUser");
      if (!(currentUser.role === "compliance")) throw new ForbiddenError("Forbidden: find all");
      const result = await repo.all();
      return c.json(result.map((r) => repo.toWire(r)) as z.infer<typeof InterestRunResponse>[], 200);
    },
  );

  app.onError((err, c) => {
    const trace_id = c.get("requestId") ?? "";
    const problem = (status: 403 | 404 | 409 | 422 | 500, title: string, detail: string) => c.body(JSON.stringify({ type: "about:blank", title, status, detail, instance: c.req.path }), status, { "content-type": "application/problem+json", "x-request-id": trace_id });
    if (err instanceof ForbiddenError) {
      c.get("log").warn({ event: "forbidden", aggregate: "InterestRun", message: err.message, status: 403 });
      recordDomainFault("forbidden");
      return problem(403, "Forbidden", err.message);
    }
    if (err instanceof DisallowedError) {
      c.get("log").warn({ event: "disallowed", aggregate: "InterestRun", message: err.message, status: 409 });
      recordDomainFault("disallowed");
      return problem(409, "Disallowed", err.message);
    }
    if (err instanceof DomainError) {
      c.get("log").warn({ event: "domain_error", aggregate: "InterestRun", message: err.message, status: 422 });
      recordDomainFault("domain_error");
      return domainFloorProblem(c, err, 422, "Unprocessable Entity") ?? problem(422, "Unprocessable Entity", err.message);
    }
    if (err instanceof AggregateNotFoundError) {
      c.get("log").warn({ event: "not_found", aggregate: "InterestRun", status: 404 });
      recordDomainFault("not_found");
      return problem(404, "Not Found", err.message);
    }
    if (err instanceof ConcurrencyError) {
      c.get("log").warn({ event: "conflict", aggregate: "InterestRun", message: err.message, status: 409 });
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

// Auto-generated.  Do not edit by hand.
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { ProblemDetails, frameworkProblemBody, newApp, parseIfMatch, requireJsonContentType, versionETag } from "./problem-details.ts";
import { HTTPException } from "hono/http-exception";
import { recordDomainFault, recordDomainOperation } from "../obs/metrics.ts";
import { Asset } from "../domain/asset.ts";
import type { AssetRepository } from "../db/repositories/asset-repository.ts";
import * as Ids from "../domain/ids.ts";
import { DomainError, AggregateNotFoundError, DisallowedError, ForbiddenError, ExternHandlerError, ConcurrencyError } from "../domain/errors.ts";

const SkillSchema = z.enum(["Electrical", "Plumbing", "HVAC", "Refrigeration"]).openapi("Skill");

const CreateAssetRequest = z.object({
  siteId: z.string().uuid(),
  serialNumber: z.string().refine((s: string) => !s.includes("\u0000")),
  model: z.string().refine((s: string) => !s.includes("\u0000")),
  warrantyExpiry: z.string().datetime({ offset: true, local: true }).transform((s: string) => new Date(s)).nullish(),
  requiredSkill: SkillSchema,
}).openapi("CreateAssetRequest");
const CreateAssetResponse = z.object({ id: z.string() }).openapi("CreateAssetResponse");

const UpdateAssetRequest = z.object({
  siteId: z.string().uuid(),
  serialNumber: z.string().refine((s: string) => !s.includes("\u0000")),
  model: z.string().refine((s: string) => !s.includes("\u0000")),
  warrantyExpiry: z.string().datetime({ offset: true, local: true }).transform((s: string) => new Date(s)).nullish(),
  requiredSkill: SkillSchema,
}).openapi("UpdateAssetRequest");

const AllQuery = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  sort: z.enum(["id", "serialNumber", "model", "requiredSkill", ""]).default("id"),
  dir: z.string().default("asc"),
}).openapi("AllQuery");
export const AssetResponse = z.object({
  id: z.string(),
  siteId: z.string(),
  serialNumber: z.string(),
  model: z.string(),
  warrantyExpiry: z.string().nullish(),
  requiredSkill: SkillSchema,
  version: z.number().int().openapi({ format: "int32" }),
  display: z.string(),
}).openapi("AssetResponse");
export const AssetListResponse = z.array(AssetResponse).openapi("AssetListResponse");
export const AssetPaged = z.object({ items: z.array(AssetResponse), page: z.number().int(), pageSize: z.number().int(), total: z.number().int(), totalPages: z.number().int() }).openapi("AssetPaged");

export function assetRoutes(repo: AssetRepository): OpenAPIHono {
  const app = newApp();

  app.openapi(
    createRoute({
      method: "post",
      path: "/",
      tags: ["assets"],
      operationId: "createAsset",
      request: {
        body: { content: { "application/json": { schema: CreateAssetRequest } } },
      },
      responses: {
        201: {
          description: "Created",
          content: { "application/json": { schema: CreateAssetResponse } },
        },
        400: { description: "Bad Request", content: { "application/problem+json": { schema: ProblemDetails } } },
        415: { description: "Unsupported Media Type", content: { "application/problem+json": { schema: ProblemDetails } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      requireJsonContentType(c);
      const body = c.req.valid("json");
      const created = Asset.create({ siteId: Ids.SiteId(body.siteId), serialNumber: body.serialNumber, model: body.model, warrantyExpiry: (body.warrantyExpiry == null ? null : body.warrantyExpiry), requiredSkill: body.requiredSkill });
      await repo.save(created);
      c.get("log").info({ event: "aggregate_created", aggregate: "Asset", id: created.id as string });
      recordDomainOperation("Asset", "create");
      return c.json({ id: created.id as string }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/{id}",
      tags: ["assets"],
      operationId: "getAssetById",
      request: { params: z.object({ id: z.string().uuid() }) },
      responses: {
        200: { description: "OK", content: { "application/json": { schema: AssetResponse } } },
        404: { description: "Not Found", content: { "application/problem+json": { schema: ProblemDetails } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const found = await repo.findById(Ids.AssetId(id));
      if (!found) throw new AggregateNotFoundError(`Asset ${id} not found`);
      c.header("etag", versionETag(found.version));
      return c.json(repo.toWire(found) as z.infer<typeof AssetResponse>, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/{id}",
      tags: ["assets"],
      operationId: "destroyAsset",
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
      await repo.getById(Ids.AssetId(id));
      try {
        await repo.delete(Ids.AssetId(id));
      } catch (err) {
        if (err && typeof err === "object" && ["23001", "23503"].includes(((err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code) as string)) {
          return c.body(JSON.stringify({ type: "about:blank", title: "Conflict", status: 409, detail: "Asset is still referenced and cannot be deleted.", instance: c.req.path }), 409, { "content-type": "application/problem+json" });
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
      tags: ["assets"],
      operationId: "updateAsset",
      request: {
        params: z.object({ id: z.string().uuid() }),
        body: { content: { "application/json": { schema: UpdateAssetRequest } } },
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
      c.get("log").info({ event: "operation_invoked", aggregate: "Asset", op: "update", id });
      recordDomainOperation("Asset", "update");
      const aggregate = await repo.getById(Ids.AssetId(id));
      const ifMatch = c.req.header("if-match");
      const expectedVersion = parseIfMatch(ifMatch, aggregate.version);
      aggregate.update(Ids.SiteId(body.siteId), body.serialNumber, body.model, (body.warrantyExpiry == null ? null : body.warrantyExpiry), body.requiredSkill);
      await repo.save(aggregate, expectedVersion);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["assets"],
      operationId: "allAsset",
      request: { query: AllQuery },
      responses: {
        200: { description: "OK", content: { "application/json": { schema: AssetPaged } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      const params = c.req.valid("query");
      const result = await repo.all(params.page, params.pageSize, params.sort, params.dir);
      return c.json({ ...result, items: result.items.map((r) => repo.toWire(r)) } as z.infer<typeof AssetPaged>, 200);
    },
  );

  app.onError((err, c) => {
    const trace_id = c.get("requestId") ?? "";
    const problem = (status: 403 | 404 | 409 | 422 | 500, title: string, detail: string) => c.body(JSON.stringify({ type: "about:blank", title, status, detail, instance: c.req.path }), status, { "content-type": "application/problem+json", "x-request-id": trace_id });
    if (err instanceof ForbiddenError) {
      c.get("log").warn({ event: "forbidden", aggregate: "Asset", message: err.message, status: 403 });
      recordDomainFault("forbidden");
      return problem(403, "Forbidden", err.message);
    }
    if (err instanceof DisallowedError) {
      c.get("log").warn({ event: "disallowed", aggregate: "Asset", message: err.message, status: 409 });
      recordDomainFault("disallowed");
      return problem(409, "Disallowed", err.message);
    }
    if (err instanceof DomainError) {
      c.get("log").warn({ event: "domain_error", aggregate: "Asset", message: err.message, status: 422 });
      recordDomainFault("domain_error");
      return problem(422, "Unprocessable Entity", err.message);
    }
    if (err instanceof AggregateNotFoundError) {
      c.get("log").warn({ event: "not_found", aggregate: "Asset", status: 404 });
      recordDomainFault("not_found");
      return problem(404, "Not Found", err.message);
    }
    if (err && typeof err === "object" && (((err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code) === "23503")) {
      c.get("log").warn({ event: "domain_error", aggregate: "Asset", message: "The request references a record that does not exist.", status: 422 });
      recordDomainFault("domain_error");
      return problem(422, "Unprocessable Entity", "The request references a record that does not exist.");
    }
    if (err && typeof err === "object" && (((err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code) === "23505")) {
      c.get("log").warn({ event: "disallowed", aggregate: "Asset", message: (err as { constraint?: string }).constraint ?? (err as { cause?: { constraint?: string } }).cause?.constraint ?? "unique_violation", status: 409 });
      recordDomainFault("disallowed");
      return problem(409, "Conflict", `A Asset with these values already exists.`);
    }
    if (err instanceof ConcurrencyError) {
      c.get("log").warn({ event: "conflict", aggregate: "Asset", message: err.message, status: 409 });
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
//# sourceMappingURL=asset.routes.ts.map

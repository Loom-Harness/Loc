// Auto-generated.  Do not edit by hand.
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { ProblemDetails, frameworkProblemBody, newApp, parseIfMatch, requireJsonContentType, versionETag } from "./problem-details";
import { HTTPException } from "hono/http-exception";
import { recordDomainFault, recordDomainOperation } from "../obs/metrics";
import { Task } from "../domain/task";
import type { TaskRepository } from "../db/repositories/task-repository";
import * as Ids from "../domain/ids";
import { DomainError, AggregateNotFoundError, DisallowedError, ForbiddenError, ExternHandlerError, ConcurrencyError } from "../domain/errors";


const CreateTaskRequest = z.object({
  title: z.string().refine((s: string) => !s.includes("\u0000")),
  done: z.boolean().default(false),
  project: z.string().uuid(),
}).openapi("CreateTaskRequest");
const CreateTaskResponse = z.object({ id: z.string() }).openapi("CreateTaskResponse");

const UpdateTaskRequest = z.object({
  title: z.string().refine((s: string) => !s.includes("\u0000")),
  done: z.boolean(),
  project: z.string().uuid(),
}).openapi("UpdateTaskRequest");

const AllQuery = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  sort: z.enum(["id", "title", "done", ""]).default("id"),
  dir: z.string().default("asc"),
}).openapi("AllQuery");
const ByProjectQuery = z.object({
  projectId: z.string().uuid(),
}).openapi("ByProjectQuery");
export const TaskResponse = z.object({
  id: z.string(),
  title: z.string(),
  done: z.boolean(),
  project: z.string(),
  version: z.number().int().openapi({ format: "int32" }),
}).openapi("TaskResponse");
export const TaskListResponse = z.array(TaskResponse).openapi("TaskListResponse");
export const TaskPaged = z.object({ items: z.array(TaskResponse), page: z.number().int(), pageSize: z.number().int(), total: z.number().int(), totalPages: z.number().int() }).openapi("TaskPaged");

export function taskRoutes(repo: TaskRepository): OpenAPIHono {
  const app = newApp();

  // A STATIC sub-path is captured by the sibling `/{id}` route under any
  // verb it does not itself serve, and the param validator then answers 422
  // for a path that has no such method at all.  405 is the honest answer and
  // the only one that can carry an `Allow` the caller can act on (RFC 9110
  // §15.5.6).  Runs BEFORE the param validator, which is why it is a
  // middleware; registered under method ALL, so the root router's
  // method probe (http/index.ts) is unaffected.
  const staticSubpathMethods: Record<string, string[]> = { by_project: ["GET"] };
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
      tags: ["tasks"],
      operationId: "createTask",
      request: {
        body: { content: { "application/json": { schema: CreateTaskRequest } } },
      },
      responses: {
        201: {
          description: "Created",
          content: { "application/json": { schema: CreateTaskResponse } },
        },
        400: { description: "Bad Request", content: { "application/problem+json": { schema: ProblemDetails } } },
        415: { description: "Unsupported Media Type", content: { "application/problem+json": { schema: ProblemDetails } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      requireJsonContentType(c);
      const body = c.req.valid("json");
      const created = Task.create({ title: body.title, done: body.done, project: Ids.ProjectId(body.project) });
      await repo.save(created);
      c.get("log").info({ event: "aggregate_created", aggregate: "Task", id: created.id as string });
      recordDomainOperation("Task", "create");
      return c.json({ id: created.id as string }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/by_project",
      tags: ["tasks"],
      operationId: "byProjectTask",
      request: { query: ByProjectQuery },
      responses: {
        200: { description: "OK", content: { "application/json": { schema: TaskListResponse } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      const params = c.req.valid("query");
      const result = await repo.byProject(Ids.ProjectId(params.projectId));
      return c.json(result.map((r) => repo.toWire(r)) as z.infer<typeof TaskResponse>[], 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/{id}",
      tags: ["tasks"],
      operationId: "getTaskById",
      request: { params: z.object({ id: z.string().uuid() }) },
      responses: {
        200: { description: "OK", content: { "application/json": { schema: TaskResponse } } },
        404: { description: "Not Found", content: { "application/problem+json": { schema: ProblemDetails } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const found = await repo.findById(Ids.TaskId(id));
      if (!found) throw new AggregateNotFoundError(`Task ${id} not found`);
      c.header("etag", versionETag(found.version));
      return c.json(repo.toWire(found) as z.infer<typeof TaskResponse>, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/{id}",
      tags: ["tasks"],
      operationId: "destroyTask",
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
      await repo.getById(Ids.TaskId(id));
      try {
        await repo.delete(Ids.TaskId(id));
      } catch (err) {
        if (err && typeof err === "object" && ["23001", "23503"].includes(((err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code) as string)) {
          return c.body(JSON.stringify({ type: "about:blank", title: "Conflict", status: 409, detail: "Task is still referenced and cannot be deleted.", instance: c.req.path }), 409, { "content-type": "application/problem+json" });
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
      tags: ["tasks"],
      operationId: "updateTask",
      request: {
        params: z.object({ id: z.string().uuid() }),
        body: { content: { "application/json": { schema: UpdateTaskRequest } } },
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
      c.get("log").info({ event: "operation_invoked", aggregate: "Task", op: "update", id });
      recordDomainOperation("Task", "update");
      const aggregate = await repo.getById(Ids.TaskId(id));
      const ifMatch = c.req.header("if-match");
      const expectedVersion = parseIfMatch(ifMatch, aggregate.version);
      aggregate.update(body.title, body.done, Ids.ProjectId(body.project));
      await repo.save(aggregate, expectedVersion);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["tasks"],
      operationId: "allTask",
      request: { query: AllQuery },
      responses: {
        200: { description: "OK", content: { "application/json": { schema: TaskPaged } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      const params = c.req.valid("query");
      const result = await repo.all(params.page, params.pageSize, params.sort, params.dir);
      return c.json({ ...result, items: result.items.map((r) => repo.toWire(r)) } as z.infer<typeof TaskPaged>, 200);
    },
  );

  app.onError((err, c) => {
    const trace_id = c.get("requestId") ?? "";
    const problem = (status: 403 | 404 | 409 | 422 | 500, title: string, detail: string) => c.body(JSON.stringify({ type: "about:blank", title, status, detail, instance: c.req.path }), status, { "content-type": "application/problem+json", "x-request-id": trace_id });
    if (err instanceof ForbiddenError) {
      c.get("log").warn({ event: "forbidden", aggregate: "Task", message: err.message, status: 403 });
      recordDomainFault("forbidden");
      return problem(403, "Forbidden", err.message);
    }
    if (err instanceof DisallowedError) {
      c.get("log").warn({ event: "disallowed", aggregate: "Task", message: err.message, status: 409 });
      recordDomainFault("disallowed");
      return problem(409, "Disallowed", err.message);
    }
    if (err instanceof DomainError) {
      c.get("log").warn({ event: "domain_error", aggregate: "Task", message: err.message, status: 422 });
      recordDomainFault("domain_error");
      return problem(422, "Unprocessable Entity", err.message);
    }
    if (err instanceof AggregateNotFoundError) {
      c.get("log").warn({ event: "not_found", aggregate: "Task", status: 404 });
      recordDomainFault("not_found");
      return problem(404, "Not Found", err.message);
    }
    if (err && typeof err === "object" && (((err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code) === "23503")) {
      c.get("log").warn({ event: "domain_error", aggregate: "Task", message: "The request references a record that does not exist.", status: 422 });
      recordDomainFault("domain_error");
      return problem(422, "Unprocessable Entity", "The request references a record that does not exist.");
    }
    if (err instanceof ConcurrencyError) {
      c.get("log").warn({ event: "conflict", aggregate: "Task", message: err.message, status: 409 });
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

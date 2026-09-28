// Auto-generated.
import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { TrieRouter } from "hono/router/trie-router";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { frameworkProblemBody } from "./problem-details.ts";
import { sql } from "drizzle-orm";
import { requestIdMiddleware } from "../obs/request-id.ts";
import { recordDomainFault, registry } from "../obs/metrics.ts";
import { AggregateNotFoundError, ConcurrencyError, DisallowedError, DomainError, ExternHandlerError, ForbiddenError } from "../domain/errors.ts";
import { baseLogger } from "../obs/log.ts";
import { authMiddleware, registerRouteProbe } from "../auth/middleware.ts";
import { assertUserVerifierRegistered } from "../auth/verifier.ts";
import { authRoutes } from "../auth/handshake.ts";
import { organizationRoutes } from "./organization.routes.ts";
import { OrganizationRepository } from "../db/repositories/organization-repository.ts";
import { customerRoutes } from "./customer.routes.ts";
import { CustomerRepository } from "../db/repositories/customer-repository.ts";
import { siteRoutes } from "./site.routes.ts";
import { SiteRepository } from "../db/repositories/site-repository.ts";
import { assetRoutes } from "./asset.routes.ts";
import { AssetRepository } from "../db/repositories/asset-repository.ts";
import { technicianRoutes } from "./technician.routes.ts";
import { TechnicianRepository } from "../db/repositories/technician-repository.ts";
import { partRoutes } from "./part.routes.ts";
import { PartRepository } from "../db/repositories/part-repository.ts";
import { workOrderRoutes } from "./workOrder.routes.ts";
import { WorkOrderRepository } from "../db/repositories/workOrder-repository.ts";
import { invoiceRoutes } from "./invoice.routes.ts";
import { InvoiceRepository } from "../db/repositories/invoice-repository.ts";
import { workflowsRoutes } from "./workflows.ts";
import { realtimeRoutes, realtimeTee } from "./realtime.ts";
import { queryProjectionsRoutes } from "./query-projections.ts";
import { fieldPhotos$getBytes, fieldPhotos$putBytes } from "../resources/s3.ts";
import { randomUUID } from "node:crypto";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../db/schema.ts";
import { type DomainEventDispatcher, NoopDomainEventDispatcher } from "../domain/events.ts";

// The verbs a method-mismatch probe asks about (see `allowedFor` below).
// Deliberately not hono's exported METHODS: that list carries `options`,
// which the CORS middleware answers for every path, so probing it would
// report an `Allow` on routes that serve nothing.
const PROBE_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

export function createApp(
  db: NodePgDatabase<typeof schema>,
  events: DomainEventDispatcher = realtimeTee(NoopDomainEventDispatcher),
): OpenAPIHono {
  assertUserVerifierRegistered();
  baseLogger.info({ event: "auth_enabled", required: true });
  const app = new OpenAPIHono();
  // Per-request correlation id + structured request_start /
  // request_end JSON log lines.  Mounted FIRST so every
  // downstream handler + onError sees the id; honours an
  // inbound X-Request-Id header so callers can thread their
  // own id through.
  app.use("*", requestIdMiddleware);
  // CORS: the compose stack sets CORS_ORIGIN to the frontend origin(s) —
  // a comma-separated allowlist.  When set, only those origins are
  // allowed (with credentials, so the session cookie flows cross-origin).
  // When unset, the fallback is permissive '*' ONLY for an auth-less
  // system; an auth-bearing system denies cross-origin by default (a
  // session cookie reflected against '*' is unsafe).  Pin http/index.ts
  // in .loomignore to override.
  const corsAllowlist = (process.env.CORS_ORIGIN ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const corsAllowAnyFallback = false;
  app.use(
    "*",
    cors({
      origin: (origin) =>
        corsAllowlist.length > 0
          ? corsAllowlist.includes(origin)
            ? origin
            : null
          : corsAllowAnyFallback
            ? origin || "*"
            : null,
      credentials: true,
    }),
  );
  app.use("*", authMiddleware);
  app.route("/api/auth", authRoutes());
  // Liveness probe — cheap, no I/O.  K8s livenessProbe / docker-compose
  // healthcheck use this to decide "is the process alive?".  A DB blip
  // must NOT mark the pod not-alive (that restarts the container);
  // DB-touching checks live on /ready instead.  Emits health_ok
  // (debug) so probe traffic shows up under LOG_LEVEL=debug — useful
  // when diagnosing why a load balancer considers the pod down.
  app.get("/health", (c) => {
    c.get("log").debug({ event: "health_ok", checks: ["liveness"] });
    return c.json({ status: "ok" });
  });
  // Readiness probe — pings the DB.  K8s readinessProbe uses this to
  // decide "should I send traffic to this pod?".  On failure, emits
  // db_error (error) + health_degraded (debug) so an operator can
  // pin the cause without exec'ing into the pod; the 503 envelope
  // still carries the message for the probe log.
  app.get("/ready", async (c) => {
    try {
      await db.execute(sql`select 1`);
      c.get("log").debug({ event: "health_ok", checks: ["readiness", "db"] });
      return c.json({ status: "ready" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      c.get("log").error({ event: "db_error", error: message });
      c.get("log").debug({ event: "health_degraded", checks: ["db"] });
      return c.json({ status: "not_ready", error: message }, 503);
    }
  });
  // Prometheus scrape target — the text exposition of the registry in
  // obs/metrics.ts (default process/runtime metrics + the HTTP
  // counter/histogram recorded by the request-id middleware).  Sits
  // beside the probes with the same access exposure; a Prometheus
  // server or the OTel collector scrapes it on the deployable's port.
  app.get("/metrics", async (c) => {
    const body = await registry.metrics();
    return c.text(body, 200, { "Content-Type": registry.contentType });
  });
  app.route("/api/organizations", organizationRoutes(new OrganizationRepository(db, events)));
  app.route("/api/customers", customerRoutes(new CustomerRepository(db, events)));
  app.route("/api/sites", siteRoutes(new SiteRepository(db, events)));
  app.route("/api/assets", assetRoutes(new AssetRepository(db, events)));
  app.route("/api/technicians", technicianRoutes(new TechnicianRepository(db, events)));
  app.route("/api/parts", partRoutes(new PartRepository(db, events)));
  app.route("/api/work_orders", workOrderRoutes(new WorkOrderRepository(db, events)));
  app.route("/api/invoices", invoiceRoutes(new InvoiceRepository(db, events)));
  app.route("/api/workflows", workflowsRoutes(db, events));
  app.route("/api/realtime", realtimeRoutes());
  app.route("/api/projections", queryProjectionsRoutes(db, events));
  // File upload — multipart POST, stores raw bytes in the 'fieldPhotos' object store,
  // returns a FileRef { url, key, contentType, size } to persist on a File field.
  app.post("/files", async (c) => {
    const body = await c.req.parseBody();
    const file = body["file"];
    if (!(file instanceof File)) {
      return c.json({ error: "expected a 'file' form field" }, 400);
    }
    const key = randomUUID();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const contentType = file.type || "application/octet-stream";
    await fieldPhotos$putBytes(key, bytes, contentType);
    return c.json({ url: "/files/" + key, key, contentType, size: bytes.byteLength }, 201);
  });
  // File download — streams the stored object back with its contentType.
  app.get("/files/:key", async (c) => {
    const key = c.req.param("key");
    const obj = await fieldPhotos$getBytes(key);
    if (!obj) throw new AggregateNotFoundError(`File ${key} not found`);
    // Copy into a standalone ArrayBuffer — Hono's c.body() rejects a
    // Uint8Array whose backing buffer is only ArrayBufferLike.
    const ab = obj.body.buffer.slice(
      obj.body.byteOffset,
      obj.body.byteOffset + obj.body.byteLength,
    ) as ArrayBuffer;
    return c.body(ab, 200, { "content-type": obj.contentType });
  });
  const frameworkProblem = (
    c: Context,
    status: ContentfulStatusCode,
    detail: string,
    extraHeaders: Record<string, string> = {},
  ) => {
    baseLogger.warn({ event: "client_error", error: detail, status });
    return c.body(frameworkProblemBody(status, detail, c.req.path), status, {
      "content-type": "application/problem+json",
      ...extraHeaders,
    });
  };
  let methodProbe: TrieRouter<string> | null = null;
  const allowedFor = (path: string): string[] => {
    if (!methodProbe) {
      methodProbe = new TrieRouter<string>();
      for (const r of app.routes) {
        if (r.method !== "ALL") methodProbe.add(r.method, r.path, r.method);
      }
    }
    const probe = methodProbe;
    return PROBE_METHODS.filter((m) => probe.match(m, path)[0].length > 0);
  };
  registerRouteProbe((m, p) => allowedFor(p).includes(m));
  app.notFound((c) => {
    const allow = allowedFor(c.req.path).filter((m) => m !== c.req.method);
    if (allow.length > 0) {
      return frameworkProblem(
        c,
        405,
        `method ${c.req.method} is not supported for ${c.req.path}`,
        { allow: allow.join(", ") },
      );
    }
    return frameworkProblem(c, 404, `no route for ${c.req.method} ${c.req.path}`);
  });
  app.onError((err, c) => {
    const trace_id = c.get("requestId") ?? "";
    const problem = (status: 403 | 404 | 409 | 422 | 500, title: string, detail: string) => c.body(JSON.stringify({ type: "about:blank", title, status, detail, instance: c.req.path }), status, { "content-type": "application/problem+json", "x-request-id": trace_id });
    if (err instanceof ForbiddenError) {
      baseLogger.warn({ event: "forbidden", message: err.message, status: 403 });
      recordDomainFault("forbidden");
      return problem(403, "Forbidden", err.message);
    }
    if (err instanceof DisallowedError) {
      baseLogger.warn({ event: "disallowed", message: err.message, status: 409 });
      recordDomainFault("disallowed");
      return problem(409, "Disallowed", err.message);
    }
    if (err instanceof DomainError) {
      baseLogger.warn({ event: "domain_error", message: err.message, status: 422 });
      recordDomainFault("domain_error");
      return problem(422, "Unprocessable Entity", err.message);
    }
    if (err instanceof AggregateNotFoundError) {
      baseLogger.warn({ event: "not_found", status: 404 });
      recordDomainFault("not_found");
      return problem(404, "Not Found", err.message);
    }
    if (err && typeof err === "object" && (((err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code) === "23505")) {
      baseLogger.warn({ event: "disallowed", message: (err as { constraint?: string }).constraint ?? (err as { cause?: { constraint?: string } }).cause?.constraint ?? "unique_violation", status: 409 });
      recordDomainFault("disallowed");
      return problem(409, "Conflict", "A record with these values already exists.");
    }
    if (err instanceof ConcurrencyError) {
      baseLogger.warn({ event: "conflict", message: err.message, status: 409 });
      recordDomainFault("conflict");
      return problem(409, "Conflict", err.message);
    }
    if (err instanceof ExternHandlerError) {
      baseLogger.error({ event: "extern_handler_threw", aggregate: err.aggName, op: err.opName, error: err.message });
      return problem(500, "Internal Server Error", "internal");
    }
    if (err instanceof HTTPException) {
      return frameworkProblem(c, err.status as ContentfulStatusCode, err.message);
    }
    const message = err instanceof Error ? err.message : String(err);
    baseLogger.error({ event: "internal_error", error: message, status: 500 });
    return frameworkProblem(c, 500, "internal");
  });
  // OpenAPI 3.1 spec assembled from every sub-router's createRoute()
  // calls.  Diffed against the .NET-emitted /openapi.json by
  // the cross-platform contract check.
  app.doc("/openapi.json", {
    openapi: "3.1.0",
    info: { title: "Generated API", version: "1.0.0" },
  });
  return app;
}

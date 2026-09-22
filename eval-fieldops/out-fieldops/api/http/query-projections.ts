// Auto-generated.  Do not edit by hand.
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { frameworkProblemBody, newApp } from "./problem-details.ts";
import { HTTPException } from "hono/http-exception";
import { DomainError, AggregateNotFoundError, ForbiddenError, ExternHandlerError } from "../domain/errors.ts";
import { type DomainEventDispatcher } from "../domain/events.ts";
import { requireCurrentUser } from "../auth/middleware.ts";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.ts";
import { count, eq, sum } from "drizzle-orm";
import Decimal from "decimal.js";
import { InvoiceRepository } from "../db/repositories/invoice-repository.ts";
import { WorkOrderRepository } from "../db/repositories/workOrder-repository.ts";
import { WorkOrderStatus, Priority, Skill } from "../domain/value-objects.ts";

const OpenByStatusRow = z.object({
  status: z.enum(["Draft", "Scheduled", "InProgress", "Completed", "Cancelled"]),
  howMany: z.number().int(),
}).openapi("OpenByStatusRow");
const OpenByStatusResponse = z.array(OpenByStatusRow).openapi("OpenByStatusResponse");
const RevenueThisMonthRow = z.object({
  revenue: z.string(),
}).openapi("RevenueThisMonthRow");
const RevenueThisMonthResponse = RevenueThisMonthRow.openapi("RevenueThisMonthResponse");

export function queryProjectionsRoutes(
  db: NodePgDatabase<typeof schema>,
  events: DomainEventDispatcher,
): OpenAPIHono {
  const app = newApp();

  app.openapi(
    createRoute({
      method: "get",
      path: "/open_by_status",
      tags: ["projections", "work_orders"],
      operationId: "projectionOpenByStatus",
      responses: {
        200: { description: "OK", content: { "application/json": { schema: OpenByStatusResponse } } },
      },
    }),
    async (httpCtx) => {
      const rows = await db.select({ status: schema.workOrders.status, howMany: count() }).from(schema.workOrders).where(eq(schema.workOrders.tenantId, requireCurrentUser().orgId)).groupBy(schema.workOrders.status).orderBy(schema.workOrders.status);
      const projected = rows.map((r) => ({
        status: r.status,
        howMany: Number(r.howMany ?? 0),
      }));
      return httpCtx.json(projected as z.infer<typeof OpenByStatusResponse>, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/revenue_this_month",
      tags: ["projections", "invoices"],
      operationId: "projectionRevenueThisMonth",
      responses: {
        200: { description: "OK", content: { "application/json": { schema: RevenueThisMonthResponse } } },
      },
    }),
    async (httpCtx) => {
      const [row] = await db.select({ revenue: sum(schema.invoices.amount) }).from(schema.invoices).where(eq(schema.invoices.tenantId, requireCurrentUser().orgId));
      const projected = {
        revenue: new Decimal(row?.revenue ?? 0).toFixed(4),
      };
      return httpCtx.json(projected as z.infer<typeof RevenueThisMonthResponse>, 200);
    },
  );

  app.onError((err, c) => {
    const trace_id = c.get("requestId") ?? "";
    const problem = (status: 400 | 403 | 404 | 422 | 500, title: string, detail: string) => c.body(JSON.stringify({ type: "about:blank", title, status, detail, instance: c.req.path }), status, { "content-type": "application/problem+json", "x-request-id": trace_id });
    if (err instanceof ForbiddenError) return problem(403, "Forbidden", err.message);
    if (err instanceof DomainError) return problem(422, "Unprocessable Entity", err.message);
    if (err instanceof AggregateNotFoundError) return problem(404, "Not Found", err.message);
    if (err instanceof ExternHandlerError) { console.error(err); return problem(500, "Internal Server Error", "internal"); }
    if (err instanceof HTTPException) { c.get("log").warn({ event: "client_error", error: err.message, status: err.status }); return c.body(frameworkProblemBody(err.status, err.message, c.req.path), err.status, { "content-type": "application/problem+json", "x-request-id": trace_id }); }
    console.error(err);
    return problem(500, "Internal Server Error", "internal");
  });

  return app;
}

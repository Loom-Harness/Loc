// Auto-generated.  Do not edit by hand.
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { frameworkProblemBody, ProblemDetails, UuidString, newApp, requireJsonContentType, domainFloorProblem } from "./problem-details";
import { HTTPException } from "hono/http-exception";
import { moneySchema } from "../lib/schemas";
import * as Ids from "../domain/ids";
import { DomainError, AggregateNotFoundError, DisallowedError, ForbiddenError, ExternHandlerError, ConcurrencyError } from "../domain/errors";
import type { DomainEventDispatcher } from "../domain/events";
import type * as Events from "../domain/events";
import Decimal from "decimal.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { requestLog } from "../obs/als";
import * as schema from "../db/schema";
import { Account } from "../domain/account";
import { Transfer } from "../domain/transfer";
import { CustomerRepository } from "../db/repositories/customer-repository";
import { AccountRepository } from "../db/repositories/account-repository";
import { TransferRepository } from "../db/repositories/transfer-repository";
import { AccountStatus, AccountType, TransferStatus } from "../domain/value-objects";

const AccountTypeSchema = z.enum(["Checking", "Savings"]).openapi("AccountType");

const OpenAccountRequest = z.object({
  owner: UuidString,
  number: z.string(),
  accountType: AccountTypeSchema,
  currency: z.string(),
}).openapi("OpenAccountRequest");
const TransferRequest = z.object({
  sourceAccount: UuidString,
  targetAccount: UuidString,
  amount: moneySchema,
  reference: z.string(),
}).openapi("TransferRequest");
const RequestLargeTransferRequest = z.object({
  sourceAccount: UuidString,
  targetAccount: UuidString,
  amount: moneySchema,
  reference: z.string(),
}).openapi("RequestLargeTransferRequest");
const ApproveTransferRequest = z.object({
  transferId: UuidString,
}).openapi("ApproveTransferRequest");
const MonthlyInterestInstanceResponse = z.object({
  run: z.string(),
}).openapi("MonthlyInterestInstanceResponse");
const MonthlyInterestInstanceListResponse = z.array(MonthlyInterestInstanceResponse).openapi("MonthlyInterestInstanceListResponse");

export function workflowsRoutes(
  db: NodePgDatabase<typeof schema>,
  events: DomainEventDispatcher,
): OpenAPIHono {
  const app = newApp();

  app.openapi(
    createRoute({
      method: "post",
      path: "/open_account",
      tags: ["workflows"],
      operationId: "openAccountWorkflow",
      request: {
        body: { content: { "application/json": { schema: OpenAccountRequest } } },
      },
      responses: {
        204: { description: "No content" },
        400: { description: "Bad Request", content: { "application/problem+json": { schema: ProblemDetails } } },
        404: { description: "Not Found", content: { "application/problem+json": { schema: ProblemDetails } } },
        415: { description: "Unsupported Media Type", content: { "application/problem+json": { schema: ProblemDetails } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
        403: { description: "Forbidden", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (httpCtx) => {
      requireJsonContentType(httpCtx);
      const body = httpCtx.req.valid("json");
      requestLog().info({ event: "workflow_started", workflow: "openAccount" });
      httpCtx.set("workflow", "openAccount");
      const owner = Ids.CustomerId(body.owner);
      const number = body.number;
      const accountType = body.accountType;
      const currency = body.currency;
      const currentUser = (httpCtx as unknown as { get(k: "currentUser"): import("../auth/user-types").User }).get("currentUser");
      const customers = new CustomerRepository(db, events);
      const accounts = new AccountRepository(db, events);
      if (!(currentUser.role === "teller" || currentUser.role === "compliance")) throw new ForbiddenError("Forbidden: IsStaff()");
      const customer = await customers.getById(owner);
      const account = Account.create({ number: number, owner: owner, accountType: accountType, currency: currency, interestRate: accountType === AccountType.Savings ? 0.02 : 0.0, status: AccountStatus.Active, balance: new Decimal("0"), dailyLimit: new Decimal("1000"), withdrawnToday: new Decimal("0"), limitDay: new Date(), openedAt: new Date() });
      await accounts.save(account);
      requestLog().info({ event: "workflow_completed", workflow: "openAccount" });
      return httpCtx.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/transfer",
      tags: ["workflows"],
      operationId: "transferWorkflow",
      request: {
        body: { content: { "application/json": { schema: TransferRequest } } },
      },
      responses: {
        204: { description: "No content" },
        400: { description: "Bad Request", content: { "application/problem+json": { schema: ProblemDetails } } },
        404: { description: "Not Found", content: { "application/problem+json": { schema: ProblemDetails } } },
        415: { description: "Unsupported Media Type", content: { "application/problem+json": { schema: ProblemDetails } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
        403: { description: "Forbidden", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (httpCtx) => {
      requireJsonContentType(httpCtx);
      const body = httpCtx.req.valid("json");
      requestLog().info({ event: "workflow_started", workflow: "transfer" });
      httpCtx.set("workflow", "transfer");
      const sourceAccount = Ids.AccountId(body.sourceAccount);
      const targetAccount = Ids.AccountId(body.targetAccount);
      const amount = body.amount;
      const reference = body.reference;
      const currentUser = (httpCtx as unknown as { get(k: "currentUser"): import("../auth/user-types").User }).get("currentUser");
      const workflowEvents: Events.DomainEvent[] = [];
      await db.transaction(async (tx) => {
        const accounts = new AccountRepository(tx, events);
        const transfers = new TransferRepository(tx, events);
        if (!(currentUser.role === "teller" || currentUser.role === "compliance" || currentUser.customerId !== null)) throw new ForbiddenError("Forbidden: IsStaff() || currentUser.customerId != null");
        if (!(sourceAccount !== targetAccount)) throw new DomainError("Precondition failed: sourceAccount != targetAccount");
        if (!(amount.gt(new Decimal("0")))) throw new DomainError("Precondition failed: amount > money(\"0\")");
        if (!(amount.lte(new Decimal("10000")))) throw new DomainError("Precondition failed: amount <= money(\"10000\")");
        const source = await accounts.getById(sourceAccount);
        const target = await accounts.getById(targetAccount);
        if (!(source.currency === target.currency)) throw new DomainError("Precondition failed: source.currency == target.currency");
        const t = Transfer.create({ reference: reference, source: sourceAccount, target: targetAccount, amount: amount, status: TransferStatus.Completed, requestedBy: currentUser.id, requestedAt: new Date(), decidedBy: null });
        if (!(currentUser.role === "teller" || currentUser.role === "compliance" || currentUser.customerId === source.owner)) throw new ForbiddenError("Forbidden: IsStaff() || OwnsAccount(owner)");
        source.debitForTransfer(amount, reference);
        if (!(true)) throw new ForbiddenError("Forbidden: true");
        target.creditForTransfer(amount, reference);
        workflowEvents.push({ type: "TransferCompleted", transfer: t.id, at: new Date() });
        await accounts.save(source);
        await accounts.save(target);
        await transfers.save(t);
      });
      for (const ev of workflowEvents) await events.dispatch(ev);
      requestLog().info({ event: "workflow_completed", workflow: "transfer" });
      return httpCtx.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/request_large_transfer",
      tags: ["workflows"],
      operationId: "requestLargeTransferWorkflow",
      request: {
        body: { content: { "application/json": { schema: RequestLargeTransferRequest } } },
      },
      responses: {
        204: { description: "No content" },
        400: { description: "Bad Request", content: { "application/problem+json": { schema: ProblemDetails } } },
        404: { description: "Not Found", content: { "application/problem+json": { schema: ProblemDetails } } },
        415: { description: "Unsupported Media Type", content: { "application/problem+json": { schema: ProblemDetails } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
        403: { description: "Forbidden", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (httpCtx) => {
      requireJsonContentType(httpCtx);
      const body = httpCtx.req.valid("json");
      requestLog().info({ event: "workflow_started", workflow: "requestLargeTransfer" });
      httpCtx.set("workflow", "requestLargeTransfer");
      const sourceAccount = Ids.AccountId(body.sourceAccount);
      const targetAccount = Ids.AccountId(body.targetAccount);
      const amount = body.amount;
      const reference = body.reference;
      const currentUser = (httpCtx as unknown as { get(k: "currentUser"): import("../auth/user-types").User }).get("currentUser");
      const accounts = new AccountRepository(db, events);
      const transfers = new TransferRepository(db, events);
      if (!(currentUser.role === "teller" || currentUser.role === "compliance" || currentUser.customerId !== null)) throw new ForbiddenError("Forbidden: IsStaff() || currentUser.customerId != null");
      if (!(sourceAccount !== targetAccount)) throw new DomainError("Precondition failed: sourceAccount != targetAccount");
      if (!(amount.gt(new Decimal("10000")))) throw new DomainError("Precondition failed: amount > money(\"10000\")");
      const source = await accounts.getById(sourceAccount);
      const target = await accounts.getById(targetAccount);
      if (!(source.currency === target.currency)) throw new DomainError("Precondition failed: source.currency == target.currency");
      const t = Transfer.create({ reference: reference, source: sourceAccount, target: targetAccount, amount: amount, status: TransferStatus.Pending, requestedBy: currentUser.id, requestedAt: new Date(), decidedBy: null });
      await transfers.save(t);
      requestLog().info({ event: "workflow_completed", workflow: "requestLargeTransfer" });
      return httpCtx.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/approve_transfer",
      tags: ["workflows"],
      operationId: "approveTransferWorkflow",
      request: {
        body: { content: { "application/json": { schema: ApproveTransferRequest } } },
      },
      responses: {
        204: { description: "No content" },
        400: { description: "Bad Request", content: { "application/problem+json": { schema: ProblemDetails } } },
        404: { description: "Not Found", content: { "application/problem+json": { schema: ProblemDetails } } },
        415: { description: "Unsupported Media Type", content: { "application/problem+json": { schema: ProblemDetails } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
        403: { description: "Forbidden", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (httpCtx) => {
      requireJsonContentType(httpCtx);
      const body = httpCtx.req.valid("json");
      requestLog().info({ event: "workflow_started", workflow: "approveTransfer" });
      httpCtx.set("workflow", "approveTransfer");
      const transferId = Ids.TransferId(body.transferId);
      const currentUser = (httpCtx as unknown as { get(k: "currentUser"): import("../auth/user-types").User }).get("currentUser");
      const workflowEvents: Events.DomainEvent[] = [];
      await db.transaction(async (tx) => {
        const transfers = new TransferRepository(tx, events);
        const accounts = new AccountRepository(tx, events);
        if (!((currentUser.permissions).includes("retail.transfersApprove"))) throw new ForbiddenError("Forbidden: currentUser.permissions.contains(permissions.transfersApprove)");
        const t = await transfers.getById(transferId);
        if (!(t.requestedBy !== currentUser.id)) throw new DomainError("Precondition failed: t.requestedBy != currentUser.id");
        const source = await accounts.getById(t.source);
        const target = await accounts.getById(t.target);
        if (!(currentUser.role === "teller" || currentUser.role === "compliance" || currentUser.customerId === source.owner)) throw new ForbiddenError("Forbidden: IsStaff() || OwnsAccount(owner)");
        source.debitForTransfer(t.amount, t.reference);
        if (!(true)) throw new ForbiddenError("Forbidden: true");
        target.creditForTransfer(t.amount, t.reference);
        if (!(true)) throw new ForbiddenError("Forbidden: true");
        t.markCompleted();
        workflowEvents.push({ type: "TransferCompleted", transfer: t.id, at: new Date() });
        await transfers.save(t);
        await accounts.save(source);
        await accounts.save(target);
      });
      for (const ev of workflowEvents) await events.dispatch(ev);
      requestLog().info({ event: "workflow_completed", workflow: "approveTransfer" });
      return httpCtx.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/monthly_interest/instances",
      tags: ["workflows"],
      operationId: "allMonthlyInterestInstances",
      responses: {
        200: { description: "OK", content: { "application/json": { schema: MonthlyInterestInstanceListResponse } } },
        403: { description: "Forbidden", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (httpCtx) => {
      const currentUser = (httpCtx as unknown as { get(k: "currentUser"): import("../auth/user-types").User }).get("currentUser");
      if (!(currentUser.role === "compliance")) throw new ForbiddenError("Forbidden: workflow monthlyInterest instances");
      const rows = await db.select().from(schema.monthlyInterests);
      return httpCtx.json(rows as unknown as z.infer<typeof MonthlyInterestInstanceListResponse>, 200);
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/monthly_interest/instances/{id}",
      tags: ["workflows"],
      operationId: "getMonthlyInterestInstanceById",
      request: { params: z.object({ id: UuidString }) },
      responses: {
        200: { description: "OK", content: { "application/json": { schema: MonthlyInterestInstanceResponse } } },
        403: { description: "Forbidden", content: { "application/problem+json": { schema: ProblemDetails } } },
        404: { description: "Not Found", content: { "application/problem+json": { schema: ProblemDetails } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (httpCtx) => {
      const { id } = httpCtx.req.valid("param");
      const currentUser = (httpCtx as unknown as { get(k: "currentUser"): import("../auth/user-types").User }).get("currentUser");
      if (!(currentUser.role === "compliance")) throw new ForbiddenError("Forbidden: workflow monthlyInterest instances");
      const rows = await db.select().from(schema.monthlyInterests).where(eq(schema.monthlyInterests.run, id)).limit(1);
      const row = rows[0];
      if (!row) throw new AggregateNotFoundError(`MonthlyInterest ${id} not found`);
      return httpCtx.json(row as unknown as z.infer<typeof MonthlyInterestInstanceResponse>, 200);
    },
  );

  app.onError((err, c) => {
    const trace_id = c.get("requestId") ?? "";
    const failedWorkflow = c.get("workflow");
    if (failedWorkflow !== undefined) {
      c.get("log").error({ event: "workflow_failed", workflow: failedWorkflow, error: err instanceof Error ? err.message : String(err) });
    }
    const problem = (status: 400 | 403 | 404 | 409 | 422 | 500, title: string, detail: string) => c.body(JSON.stringify({ type: "about:blank", title, status, detail, instance: c.req.path }), status, { "content-type": "application/problem+json", "x-request-id": trace_id });
    if (err instanceof ForbiddenError) return problem(403, "Forbidden", err.message);
    if (err instanceof DisallowedError) return problem(409, "Disallowed", err.message);
    if (err instanceof DomainError) return domainFloorProblem(c, err, 422, "Unprocessable Entity") ?? problem(422, "Unprocessable Entity", err.message);
    if (err instanceof AggregateNotFoundError) return problem(404, "Not Found", err.message);
    if (err && typeof err === "object" && (((err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code) === "23505")) return problem(409, "Conflict", "A record with these values already exists.");
    if (err instanceof ConcurrencyError) return problem(409, "Conflict", err.message);
    if (err instanceof ExternHandlerError) { c.get("log").error({ event: "extern_handler_threw", aggregate: err.aggName, op: err.opName, error: err.message }); return problem(500, "Internal Server Error", "internal"); }
    if (err instanceof HTTPException) { c.get("log").warn({ event: "client_error", error: err.message, status: err.status }); return c.body(frameworkProblemBody(err.status, err.message, c.req.path), err.status, { "content-type": "application/problem+json", "x-request-id": trace_id }); }
    c.get("log").error({ event: "internal_error", error: err instanceof Error ? err.message : String(err), status: 500 });
    return problem(500, "Internal Server Error", "internal");
  });

  return app;
}

type MonthlyInterestState = typeof schema.monthlyInterests.$inferInsert;
async function loadMonthlyInterest(
  db: NodePgDatabase<typeof schema>,
  key: string,
): Promise<MonthlyInterestState | undefined> {
  const rows = await db.select().from(schema.monthlyInterests).where(eq(schema.monthlyInterests.run, key)).limit(1);
  return rows[0];
}
async function saveMonthlyInterest(db: NodePgDatabase<typeof schema>, state: MonthlyInterestState): Promise<void> {
  await db.insert(schema.monthlyInterests).values(state).onConflictDoUpdate({ target: schema.monthlyInterests.run, set: state });
}

export async function monthlyInterestStartMonthEnd(
  db: NodePgDatabase<typeof schema>,
  events: DomainEventDispatcher,
  e: Events.MonthEnd,
): Promise<void> {
  const __key = e.run;
  const state = (await loadMonthlyInterest(db, __key)) ?? { run: __key };
  const accounts = new AccountRepository(db, events);
  const accts = await accounts.runActiveSavings();
  for (const a of accts) {
    if (!(true)) throw new ForbiddenError("Forbidden: true");
    a.accrueInterest(e.at);
    await accounts.save(a);
  }
  await saveMonthlyInterest(db, state);
}

export function createInProcessDispatcher(
  db: NodePgDatabase<typeof schema>,
): DomainEventDispatcher {
  const dispatcher: DomainEventDispatcher = {
    async dispatch(event: Events.DomainEvent): Promise<void> {
      switch (event.type) {
        case "MonthEnd": {
          await monthlyInterestStartMonthEnd(db, dispatcher, event);
          break;
        }
        default:
          break;
      }
    },
  };
  return dispatcher;
}

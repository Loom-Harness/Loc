// Auto-generated.  Do not edit by hand.
import { moneySchema } from "../lib/schemas";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { ProblemDetails, UuidString, frameworkProblemBody, newApp, requireJsonContentType, versionETag, domainFloorProblem } from "./problem-details";
import { HTTPException } from "hono/http-exception";
import { recordDomainFault, recordDomainOperation } from "../obs/metrics";
import { Account } from "../domain/account";
import type { AccountRepository } from "../db/repositories/account-repository";
import * as Ids from "../domain/ids";
import { DomainError, AggregateNotFoundError, DisallowedError, ForbiddenError, ExternHandlerError, ConcurrencyError } from "../domain/errors";

const AccountStatusSchema = z.enum(["Active", "Frozen", "Closed"]).openapi("AccountStatus");
const AccountTypeSchema = z.enum(["Checking", "Savings"]).openapi("AccountType");
const EntryKindSchema = z.enum(["Deposit", "Withdrawal", "TransferIn", "TransferOut"]).openapi("EntryKind");

const DepositAccountRequest = z.object({
  amount: moneySchema,
  memo: z.string().refine((s: string) => !s.includes("\u0000")),
}).openapi("DepositAccountRequest");
const WithdrawAccountRequest = z.object({
  amount: moneySchema,
  memo: z.string().refine((s: string) => !s.includes("\u0000")),
}).openapi("WithdrawAccountRequest");
const DebitForTransferAccountRequest = z.object({
  amount: moneySchema,
  ref: z.string().refine((s: string) => !s.includes("\u0000")),
}).openapi("DebitForTransferAccountRequest");
const CreditForTransferAccountRequest = z.object({
  amount: moneySchema,
  ref: z.string().refine((s: string) => !s.includes("\u0000")),
}).openapi("CreditForTransferAccountRequest");
const AccrueInterestAccountRequest = z.object({
  asOf: z.string().datetime({ offset: true, local: true }).transform((s: string) => new Date(s)),
}).openapi("AccrueInterestAccountRequest");
const FreezeAccountRequest = z.object({
}).openapi("FreezeAccountRequest");
const UnfreezeAccountRequest = z.object({
}).openapi("UnfreezeAccountRequest");
const CloseAccountRequest = z.object({
}).openapi("CloseAccountRequest");

const ByNumberQuery = z.object({
  number: z.string(),
}).openapi("ByNumberQuery");
export const LedgerEntryResponse = z.object({
  id: z.string(),
  kind: EntryKindSchema,
  amount: z.string(),
  balanceAfter: z.string(),
  at: z.string(),
  memo: z.string(),
}).openapi("LedgerEntryResponse");
export const AccountResponse = z.object({
  id: z.string(),
  number: z.string(),
  owner: z.string(),
  accountType: AccountTypeSchema,
  currency: z.string(),
  status: AccountStatusSchema,
  balance: z.string(),
  interestRate: z.number(),
  dailyLimit: z.string(),
  withdrawnToday: z.string(),
  limitDay: z.string(),
  openedAt: z.string(),
  version: z.number().int().openapi({ format: "int32" }),
  entries: z.array(LedgerEntryResponse),
  display: z.string(),
}).openapi("AccountResponse");
export const AccountListResponse = z.array(AccountResponse).openapi("AccountListResponse");

export function accountRoutes(repo: AccountRepository): OpenAPIHono {
  const app = newApp();

  // A STATIC sub-path is captured by the sibling `/{id}` route under any
  // verb it does not itself serve, and the param validator then answers 422
  // for a path that has no such method at all.  405 is the honest answer and
  // the only one that can carry an `Allow` the caller can act on (RFC 9110
  // §15.5.6).  Runs BEFORE the param validator, which is why it is a
  // middleware; registered under method ALL, so the root router's
  // method probe (http/index.ts) is unaffected.
  const staticSubpathMethods: Record<string, string[]> = { by_number: ["GET"], mine: ["GET"] };
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
      path: "/by_number",
      tags: ["accounts"],
      operationId: "byNumberAccount",
      request: { query: ByNumberQuery },
      responses: {
        200: { description: "OK", content: { "application/json": { schema: AccountResponse } } },
        403: { description: "Forbidden", content: { "application/problem+json": { schema: ProblemDetails } } },
        404: { description: "Not Found", content: { "application/problem+json": { schema: ProblemDetails } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      const params = c.req.valid("query");
      const currentUser = (c as unknown as { get(k: "currentUser"): import("../auth/user-types").User }).get("currentUser");
      if (!(currentUser.role === "teller" || currentUser.role === "compliance")) throw new ForbiddenError("Forbidden: find byNumber");
      const result = await repo.byNumber(params.number);
      if (result == null) throw new AggregateNotFoundError("not_found");
      return c.json(repo.toWire(result) as z.infer<typeof AccountResponse>, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/mine",
      tags: ["accounts"],
      operationId: "mineAccount",
      responses: {
        200: { description: "OK", content: { "application/json": { schema: AccountListResponse } } },
        403: { description: "Forbidden", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      const currentUser = (c as unknown as { get(k: "currentUser"): import("../auth/user-types").User }).get("currentUser");
      if (!(true)) throw new ForbiddenError("Forbidden: find mine");
      const result = await repo.mine(currentUser);
      return c.json(result.map((r) => repo.toWire(r)) as z.infer<typeof AccountResponse>[], 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/{id}",
      tags: ["accounts"],
      operationId: "getAccountById",
      request: { params: z.object({ id: UuidString }) },
      responses: {
        200: { description: "OK", content: { "application/json": { schema: AccountResponse } } },
        404: { description: "Not Found", content: { "application/problem+json": { schema: ProblemDetails } } },
        422: { description: "Unprocessable Entity", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const found = await repo.findById(Ids.AccountId(id));
      if (!found) throw new AggregateNotFoundError(`Account ${id} not found`);
      c.header("etag", versionETag(found.version));
      return c.json(repo.toWire(found) as z.infer<typeof AccountResponse>, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/{id}/deposit",
      tags: ["accounts"],
      operationId: "depositAccount",
      request: {
        params: z.object({ id: UuidString }),
        body: { content: { "application/json": { schema: DepositAccountRequest } } },
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
      c.get("log").info({ event: "operation_invoked", aggregate: "Account", op: "deposit", id });
      recordDomainOperation("Account", "deposit");
      const currentUser = (c as unknown as { get(k: "currentUser"): import("../auth/user-types").User }).get("currentUser");
      const aggregate = await repo.getById(Ids.AccountId(id));
      if (!(currentUser.role === "teller" || currentUser.role === "compliance" || currentUser.customerId === aggregate.owner)) throw new ForbiddenError("Forbidden: IsStaff() || OwnsAccount(owner)");
      aggregate.deposit(body.amount, body.memo);
      await repo.save(aggregate);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/{id}/withdraw",
      tags: ["accounts"],
      operationId: "withdrawAccount",
      request: {
        params: z.object({ id: UuidString }),
        body: { content: { "application/json": { schema: WithdrawAccountRequest } } },
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
      c.get("log").info({ event: "operation_invoked", aggregate: "Account", op: "withdraw", id });
      recordDomainOperation("Account", "withdraw");
      const currentUser = (c as unknown as { get(k: "currentUser"): import("../auth/user-types").User }).get("currentUser");
      const aggregate = await repo.getById(Ids.AccountId(id));
      if (!(currentUser.role === "teller" || currentUser.role === "compliance" || currentUser.customerId === aggregate.owner)) throw new ForbiddenError("Forbidden: IsStaff() || OwnsAccount(owner)");
      aggregate.withdraw(body.amount, body.memo);
      await repo.save(aggregate);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/{id}/debit_for_transfer",
      tags: ["accounts"],
      operationId: "debitForTransferAccount",
      request: {
        params: z.object({ id: UuidString }),
        body: { content: { "application/json": { schema: DebitForTransferAccountRequest } } },
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
      c.get("log").info({ event: "operation_invoked", aggregate: "Account", op: "debitForTransfer", id });
      recordDomainOperation("Account", "debitForTransfer");
      const currentUser = (c as unknown as { get(k: "currentUser"): import("../auth/user-types").User }).get("currentUser");
      const aggregate = await repo.getById(Ids.AccountId(id));
      if (!(currentUser.role === "teller" || currentUser.role === "compliance" || currentUser.customerId === aggregate.owner)) throw new ForbiddenError("Forbidden: IsStaff() || OwnsAccount(owner)");
      aggregate.debitForTransfer(body.amount, body.ref);
      await repo.save(aggregate);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/{id}/credit_for_transfer",
      tags: ["accounts"],
      operationId: "creditForTransferAccount",
      request: {
        params: z.object({ id: UuidString }),
        body: { content: { "application/json": { schema: CreditForTransferAccountRequest } } },
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
      c.get("log").info({ event: "operation_invoked", aggregate: "Account", op: "creditForTransfer", id });
      recordDomainOperation("Account", "creditForTransfer");
      const aggregate = await repo.getById(Ids.AccountId(id));
      if (!(true)) throw new ForbiddenError("Forbidden: true");
      aggregate.creditForTransfer(body.amount, body.ref);
      await repo.save(aggregate);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/{id}/accrue_interest",
      tags: ["accounts"],
      operationId: "accrueInterestAccount",
      request: {
        params: z.object({ id: UuidString }),
        body: { content: { "application/json": { schema: AccrueInterestAccountRequest } } },
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
      c.get("log").info({ event: "operation_invoked", aggregate: "Account", op: "accrueInterest", id });
      recordDomainOperation("Account", "accrueInterest");
      const aggregate = await repo.getById(Ids.AccountId(id));
      if (!(true)) throw new ForbiddenError("Forbidden: true");
      aggregate.accrueInterest(body.asOf);
      await repo.save(aggregate);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/{id}/freeze",
      tags: ["accounts"],
      operationId: "freezeAccount",
      request: {
        params: z.object({ id: UuidString }),
        body: { content: { "application/json": { schema: FreezeAccountRequest } } },
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
      c.get("log").info({ event: "operation_invoked", aggregate: "Account", op: "freeze", id });
      recordDomainOperation("Account", "freeze");
      const currentUser = (c as unknown as { get(k: "currentUser"): import("../auth/user-types").User }).get("currentUser");
      const aggregate = await repo.getById(Ids.AccountId(id));
      if (!((currentUser.permissions).includes("retail.accountsFreeze") || (currentUser.permissions).includes("retail.accountsUnfreeze"))) throw new ForbiddenError("Forbidden: currentUser.permissions.contains(permissions.accountsFreeze)");
      aggregate.freeze();
      await repo.save(aggregate);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/{id}/unfreeze",
      tags: ["accounts"],
      operationId: "unfreezeAccount",
      request: {
        params: z.object({ id: UuidString }),
        body: { content: { "application/json": { schema: UnfreezeAccountRequest } } },
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
      c.get("log").info({ event: "operation_invoked", aggregate: "Account", op: "unfreeze", id });
      recordDomainOperation("Account", "unfreeze");
      const currentUser = (c as unknown as { get(k: "currentUser"): import("../auth/user-types").User }).get("currentUser");
      const aggregate = await repo.getById(Ids.AccountId(id));
      if (!((currentUser.permissions).includes("retail.accountsUnfreeze"))) throw new ForbiddenError("Forbidden: currentUser.permissions.contains(permissions.accountsUnfreeze)");
      aggregate.unfreeze();
      await repo.save(aggregate);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/{id}/close",
      tags: ["accounts"],
      operationId: "closeAccount",
      request: {
        params: z.object({ id: UuidString }),
        body: { content: { "application/json": { schema: CloseAccountRequest } } },
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
      c.get("log").info({ event: "operation_invoked", aggregate: "Account", op: "close", id });
      recordDomainOperation("Account", "close");
      const currentUser = (c as unknown as { get(k: "currentUser"): import("../auth/user-types").User }).get("currentUser");
      const aggregate = await repo.getById(Ids.AccountId(id));
      if (!(currentUser.role === "teller" || currentUser.role === "compliance")) throw new ForbiddenError("Forbidden: IsStaff()");
      aggregate.close();
      await repo.save(aggregate);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["accounts"],
      operationId: "allAccount",
      responses: {
        200: { description: "OK", content: { "application/json": { schema: AccountListResponse } } },
        403: { description: "Forbidden", content: { "application/problem+json": { schema: ProblemDetails } } },
      },
    }),
    async (c) => {
      const currentUser = (c as unknown as { get(k: "currentUser"): import("../auth/user-types").User }).get("currentUser");
      if (!(currentUser.role === "teller" || currentUser.role === "compliance")) throw new ForbiddenError("Forbidden: find all");
      const result = await repo.all();
      return c.json(result.map((r) => repo.toWire(r)) as z.infer<typeof AccountResponse>[], 200);
    },
  );

  app.onError((err, c) => {
    const trace_id = c.get("requestId") ?? "";
    const problem = (status: 403 | 404 | 409 | 422 | 500, title: string, detail: string) => c.body(JSON.stringify({ type: "about:blank", title, status, detail, instance: c.req.path }), status, { "content-type": "application/problem+json", "x-request-id": trace_id });
    if (err instanceof ForbiddenError) {
      c.get("log").warn({ event: "forbidden", aggregate: "Account", message: err.message, status: 403 });
      recordDomainFault("forbidden");
      return problem(403, "Forbidden", err.message);
    }
    if (err instanceof DisallowedError) {
      c.get("log").warn({ event: "disallowed", aggregate: "Account", message: err.message, status: 409 });
      recordDomainFault("disallowed");
      return problem(409, "Disallowed", err.message);
    }
    if (err instanceof DomainError) {
      c.get("log").warn({ event: "domain_error", aggregate: "Account", message: err.message, status: 422 });
      recordDomainFault("domain_error");
      return domainFloorProblem(c, err, 422, "Unprocessable Entity") ?? problem(422, "Unprocessable Entity", err.message);
    }
    if (err instanceof AggregateNotFoundError) {
      c.get("log").warn({ event: "not_found", aggregate: "Account", status: 404 });
      recordDomainFault("not_found");
      return problem(404, "Not Found", err.message);
    }
    if (err && typeof err === "object" && (((err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code) === "23503")) {
      c.get("log").warn({ event: "domain_error", aggregate: "Account", message: "The request references a record that does not exist.", status: 422 });
      recordDomainFault("domain_error");
      return problem(422, "Unprocessable Entity", "The request references a record that does not exist.");
    }
    if (err && typeof err === "object" && (((err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code) === "23505")) {
      c.get("log").warn({ event: "disallowed", aggregate: "Account", message: (err as { constraint?: string }).constraint ?? (err as { cause?: { constraint?: string } }).cause?.constraint ?? "unique_violation", status: 409 });
      recordDomainFault("disallowed");
      return problem(409, "Conflict", `A Account with these values already exists.`);
    }
    if (err instanceof ConcurrencyError) {
      c.get("log").warn({ event: "conflict", aggregate: "Account", message: err.message, status: 409 });
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

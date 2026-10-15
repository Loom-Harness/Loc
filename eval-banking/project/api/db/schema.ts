// Auto-generated.
import { pgSchema, text, integer, numeric, timestamp, uuid, index } from "drizzle-orm/pg-core";

export const bankingSchema = pgSchema("banking");

export const accountStatusValues = ["Active", "Frozen", "Closed"] as const;
export const accountTypeValues = ["Checking", "Savings"] as const;
export const entryKindValues = ["Deposit", "Withdrawal", "TransferIn", "TransferOut"] as const;
export const transferStatusValues = ["Pending", "Completed", "Rejected"] as const;

export const customers = bankingSchema.table("customers", {
  id: uuid("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull(),
  version: integer("version").notNull(),
});

export const accounts = bankingSchema.table("accounts", {
  id: uuid("id").primaryKey(),
  number: text("number").notNull(),
  owner: uuid("owner").notNull(),
  accountType: text("account_type", { enum: accountTypeValues }).notNull(),
  currency: text("currency").notNull(),
  status: text("status", { enum: accountStatusValues }).notNull(),
  balance: numeric("balance", { precision: 19, scale: 4 }).notNull(),
  interestRate: numeric("interest_rate").notNull(),
  dailyLimit: numeric("daily_limit", { precision: 19, scale: 4 }).notNull(),
  withdrawnToday: numeric("withdrawn_today", { precision: 19, scale: 4 }).notNull(),
  limitDay: timestamp("limit_day", { withTimezone: true }).notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
  version: integer("version").notNull(),
}, (table) => ({
    accountNumberIdx: index("accounts_number_idx").on(table.number),
    accountOwnerIdx: index("accounts_owner_idx").on(table.owner),
}));

export const ledgerEntries = bankingSchema.table("ledger_entries", {
  id: uuid("id").primaryKey(),
  parentId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: entryKindValues }).notNull(),
  amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
  balanceAfter: numeric("balance_after", { precision: 19, scale: 4 }).notNull(),
  at: timestamp("at", { withTimezone: true }).notNull(),
  memo: text("memo").notNull(),
}, (table) => ({
    ledgerEntryAccountIdIdx: index("ledger_entries_account_id_idx").on(table.parentId),
}));

export const transfers = bankingSchema.table("transfers", {
  id: uuid("id").primaryKey(),
  reference: text("reference").notNull(),
  source: uuid("source").notNull(),
  target: uuid("target").notNull(),
  amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
  status: text("status", { enum: transferStatusValues }).notNull(),
  requestedBy: text("requested_by").notNull(),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
  decidedBy: text("decided_by"),
  version: integer("version").notNull(),
}, (table) => ({
    transferStatusIdx: index("transfers_status_idx").on(table.status),
}));

export const interestRuns = bankingSchema.table("interest_runs", {
  id: uuid("id").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  version: integer("version").notNull(),
});

export const monthlyInterests = bankingSchema.table("monthly_interests", {
  run: uuid("run").primaryKey(),
});

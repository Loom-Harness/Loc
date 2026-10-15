// Auto-generated.

export const AccountStatus = {
  Active: "Active",
  Frozen: "Frozen",
  Closed: "Closed"
} as const;
export type AccountStatus = "Active" | "Frozen" | "Closed";

export const AccountType = {
  Checking: "Checking",
  Savings: "Savings"
} as const;
export type AccountType = "Checking" | "Savings";

export const EntryKind = {
  Deposit: "Deposit",
  Withdrawal: "Withdrawal",
  TransferIn: "TransferIn",
  TransferOut: "TransferOut"
} as const;
export type EntryKind = "Deposit" | "Withdrawal" | "TransferIn" | "TransferOut";

export const TransferStatus = {
  Pending: "Pending",
  Completed: "Completed",
  Rejected: "Rejected"
} as const;
export type TransferStatus = "Pending" | "Completed" | "Rejected";


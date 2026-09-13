// Auto-generated.
import { DomainError } from "./errors";

export const WorkOrderStatus = {
  Draft: "Draft",
  Scheduled: "Scheduled",
  InProgress: "InProgress",
  Completed: "Completed",
  Cancelled: "Cancelled"
} as const;
export type WorkOrderStatus = "Draft" | "Scheduled" | "InProgress" | "Completed" | "Cancelled";

export const Priority = {
  Low: "Low",
  Normal: "Normal",
  High: "High",
  Urgent: "Urgent"
} as const;
export type Priority = "Low" | "Normal" | "High" | "Urgent";

export const LineKind = {
  Labour: "Labour",
  Parts: "Parts"
} as const;
export type LineKind = "Labour" | "Parts";

export class Money {
  readonly amount: number;
  readonly currency: string;
  constructor(
    amount: number,
    currency: string
  ) {
    this.amount = amount;
    this.currency = currency;
    if (!(this.amount >= 0)) throw new DomainError("Invariant violated: amount >= 0");
    if (!([...this.currency].length === 3)) throw new DomainError("Invariant violated: currency.length == 3");
  }

  equals(other: Money): boolean {
    return this.amount === other.amount && this.currency === other.currency;
  }

}


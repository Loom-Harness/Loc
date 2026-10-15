// Auto-generated.  Do not edit by hand.
// Domain-owned repository ports (hexagonal architecture — audit S7).
import type * as Ids from "./ids";
import type { User } from "../auth/user-types";
import type { Account } from "./account";
import type { Customer } from "./customer";
import type { InterestRun } from "./interestRun";
import type { Transfer } from "./transfer";

export interface CustomerRepositoryPort {
  findById(id: Ids.CustomerId): Promise<Customer | null>;
  getById(id: Ids.CustomerId): Promise<Customer>;
  findManyByIds(ids: Ids.CustomerId[]): Promise<Customer[]>;
  save(aggregate: Customer, expectedVersion?: number): Promise<void>;
  all(): Promise<Customer[]>;
}

export interface AccountRepositoryPort {
  findById(id: Ids.AccountId): Promise<Account | null>;
  getById(id: Ids.AccountId): Promise<Account>;
  findManyByIds(ids: Ids.AccountId[]): Promise<Account[]>;
  save(aggregate: Account, expectedVersion?: number): Promise<void>;
  all(): Promise<Account[]>;
  byNumber(number: string): Promise<Account | null>;
  mine(currentUser: User): Promise<Account[]>;
  runActiveSavings(page?: { offset?: number; limit?: number }): Promise<Account[]>;
}

export interface TransferRepositoryPort {
  findById(id: Ids.TransferId): Promise<Transfer | null>;
  getById(id: Ids.TransferId): Promise<Transfer>;
  findManyByIds(ids: Ids.TransferId[]): Promise<Transfer[]>;
  save(aggregate: Transfer, expectedVersion?: number): Promise<void>;
  all(): Promise<Transfer[]>;
  pending(): Promise<Transfer[]>;
}

export interface InterestRunRepositoryPort {
  findById(id: Ids.InterestRunId): Promise<InterestRun | null>;
  getById(id: Ids.InterestRunId): Promise<InterestRun>;
  findManyByIds(ids: Ids.InterestRunId[]): Promise<InterestRun[]>;
  save(aggregate: InterestRun, expectedVersion?: number): Promise<void>;
  all(): Promise<InterestRun[]>;
}

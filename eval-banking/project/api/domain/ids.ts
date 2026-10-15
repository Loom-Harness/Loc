// Auto-generated.
import { uuidv7 } from "uuidv7";

export type CustomerId = string & { readonly __brand: "CustomerId" };
export const CustomerId = (value: string): CustomerId => value as CustomerId;
export const newCustomerId = (): CustomerId => uuidv7() as CustomerId;

export type AccountId = string & { readonly __brand: "AccountId" };
export const AccountId = (value: string): AccountId => value as AccountId;
export const newAccountId = (): AccountId => uuidv7() as AccountId;

export type LedgerEntryId = string & { readonly __brand: "LedgerEntryId" };
export const LedgerEntryId = (value: string): LedgerEntryId => value as LedgerEntryId;
export const newLedgerEntryId = (): LedgerEntryId => uuidv7() as LedgerEntryId;

export type TransferId = string & { readonly __brand: "TransferId" };
export const TransferId = (value: string): TransferId => value as TransferId;
export const newTransferId = (): TransferId => uuidv7() as TransferId;

export type InterestRunId = string & { readonly __brand: "InterestRunId" };
export const InterestRunId = (value: string): InterestRunId => value as InterestRunId;
export const newInterestRunId = (): InterestRunId => uuidv7() as InterestRunId;


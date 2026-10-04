// Auto-generated.  Do not edit by hand.
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, seg } from "./client";
import { moneySchema } from "../lib/schemas";

export const AccountStatusSchema = z.enum(["Active", "Frozen", "Closed"]);
export const AccountTypeSchema = z.enum(["Checking", "Savings"]);
export const EntryKindSchema = z.enum(["Deposit", "Withdrawal", "TransferIn", "TransferOut"]);


export const DepositAccountRequest = z.object({
  amount: moneySchema,
  memo: z.string(),
});
export type DepositAccountRequest = z.infer<typeof DepositAccountRequest>;
/** Pre-parse form shape (z.input) — money fields are decimal strings. */
export type DepositAccountFormState = z.input<typeof DepositAccountRequest>;
/** Post-parse payload shape (z.output) — money fields are Decimal. */
export type DepositAccountPayload = z.output<typeof DepositAccountRequest>;
export const WithdrawAccountRequest = z.object({
  amount: moneySchema,
  memo: z.string(),
});
export type WithdrawAccountRequest = z.infer<typeof WithdrawAccountRequest>;
/** Pre-parse form shape (z.input) — money fields are decimal strings. */
export type WithdrawAccountFormState = z.input<typeof WithdrawAccountRequest>;
/** Post-parse payload shape (z.output) — money fields are Decimal. */
export type WithdrawAccountPayload = z.output<typeof WithdrawAccountRequest>;
export const DebitForTransferAccountRequest = z.object({
  amount: moneySchema,
  ref: z.string(),
});
export type DebitForTransferAccountRequest = z.infer<typeof DebitForTransferAccountRequest>;
/** Pre-parse form shape (z.input) — money fields are decimal strings. */
export type DebitForTransferAccountFormState = z.input<typeof DebitForTransferAccountRequest>;
/** Post-parse payload shape (z.output) — money fields are Decimal. */
export type DebitForTransferAccountPayload = z.output<typeof DebitForTransferAccountRequest>;
export const CreditForTransferAccountRequest = z.object({
  amount: moneySchema,
  ref: z.string(),
});
export type CreditForTransferAccountRequest = z.infer<typeof CreditForTransferAccountRequest>;
/** Pre-parse form shape (z.input) — money fields are decimal strings. */
export type CreditForTransferAccountFormState = z.input<typeof CreditForTransferAccountRequest>;
/** Post-parse payload shape (z.output) — money fields are Decimal. */
export type CreditForTransferAccountPayload = z.output<typeof CreditForTransferAccountRequest>;
export const AccrueInterestAccountRequest = z.object({
  asOf: z.string(),
});
export type AccrueInterestAccountRequest = z.infer<typeof AccrueInterestAccountRequest>;
export const FreezeAccountRequest = z.object({
});
export type FreezeAccountRequest = z.infer<typeof FreezeAccountRequest>;
export const UnfreezeAccountRequest = z.object({
});
export type UnfreezeAccountRequest = z.infer<typeof UnfreezeAccountRequest>;
export const CloseAccountRequest = z.object({
});
export type CloseAccountRequest = z.infer<typeof CloseAccountRequest>;

export const ByNumberQuery = z.object({
  number: z.string(),
});
export type ByNumberQuery = z.infer<typeof ByNumberQuery>;
export const MineQuery = z.object({
});
export type MineQuery = z.infer<typeof MineQuery>;

export const LedgerEntryResponse = z.object({
  id: z.string(),
  kind: EntryKindSchema,
  amount: moneySchema,
  balanceAfter: moneySchema,
  at: z.string(),
  memo: z.string(),
});
export type LedgerEntryResponse = z.infer<typeof LedgerEntryResponse>;
export const AccountResponse = z.object({
  id: z.string(),
  number: z.string(),
  owner: z.string(),
  accountType: AccountTypeSchema,
  currency: z.string(),
  status: AccountStatusSchema,
  balance: moneySchema,
  interestRate: z.number(),
  dailyLimit: moneySchema,
  withdrawnToday: moneySchema,
  limitDay: z.string(),
  openedAt: z.string(),
  version: z.number().int(),
  entries: z.array(LedgerEntryResponse),
  display: z.string(),
});
export type AccountResponse = z.infer<typeof AccountResponse>;
export const AccountListResponse = z.array(AccountResponse);
export type AccountListResponse = z.infer<typeof AccountListResponse>;

export function useAllAccounts() {
  return useQuery({
    queryKey: ["accounts"],
    queryFn: async () => {
      const r = await api.get(`/accounts`);
      return AccountListResponse.parse(r);
    },
  });
}

export function useAccountById(id: string | undefined) {
  return useQuery({
    queryKey: ["accounts", id],
    enabled: !!id,
    queryFn: async () => {
      const r = await api.get(`/accounts/${seg(id)}`);
      return AccountResponse.parse(r);
    },
  });
}

export function useDepositAccount(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: DepositAccountRequest) => {
      await api.post(`/accounts/${seg(id)}/deposit`, input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts", id] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

export function useWithdrawAccount(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: WithdrawAccountRequest) => {
      await api.post(`/accounts/${seg(id)}/withdraw`, input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts", id] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

export function useDebitForTransferAccount(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: DebitForTransferAccountRequest) => {
      await api.post(`/accounts/${seg(id)}/debit_for_transfer`, input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts", id] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

export function useCreditForTransferAccount(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreditForTransferAccountRequest) => {
      await api.post(`/accounts/${seg(id)}/credit_for_transfer`, input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts", id] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

export function useAccrueInterestAccount(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AccrueInterestAccountRequest) => {
      await api.post(`/accounts/${seg(id)}/accrue_interest`, input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts", id] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

export function useFreezeAccount(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: FreezeAccountRequest) => {
      await api.post(`/accounts/${seg(id)}/freeze`, input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts", id] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

export function useUnfreezeAccount(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UnfreezeAccountRequest) => {
      await api.post(`/accounts/${seg(id)}/unfreeze`, input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts", id] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

export function useCloseAccount(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CloseAccountRequest) => {
      await api.post(`/accounts/${seg(id)}/close`, input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts", id] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

export function useByNumberAccount(query: ByNumberQuery) {
  return useQuery({
    queryKey: ["accounts", "find", "by_number", query],
    queryFn: async () => {
      const qs = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString();
      const r = await api.get(`/accounts/by_number${qs ? "?" + qs : ""}`);
      return AccountResponse.nullable().parse(r);
    },
  });
}

export function useMineAccount(query: MineQuery = {}) {
  return useQuery({
    queryKey: ["accounts", "find", "mine", query],
    queryFn: async () => {
      const qs = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString();
      const r = await api.get(`/accounts/mine${qs ? "?" + qs : ""}`);
      return AccountListResponse.parse(r);
    },
  });
}

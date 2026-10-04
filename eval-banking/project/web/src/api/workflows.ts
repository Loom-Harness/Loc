// Auto-generated.  Do not edit by hand.
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, seg } from "./client";
import { moneySchema } from "../lib/schemas";
import { AccountTypeSchema } from "./account";

export const ApproveTransferRequest = z.object({
  transferId: z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/),
});
export type ApproveTransferRequest = z.infer<typeof ApproveTransferRequest>;

export function useApproveTransferWorkflow() {
  return useMutation({
    mutationFn: async (input: ApproveTransferRequest) => {
      await api.post(`/workflows/approve_transfer`, input);
    },
  });
}

export const MonthlyInterestRequest = z.object({
  e: z.unknown(),
});
export type MonthlyInterestRequest = z.infer<typeof MonthlyInterestRequest>;

export function useMonthlyInterestWorkflow() {
  return useMutation({
    mutationFn: async (input: MonthlyInterestRequest) => {
      await api.post(`/workflows/monthly_interest`, input);
    },
  });
}

export const MonthlyInterestInstanceResponse = z.object({
  run: z.string(),
});
export type MonthlyInterestInstanceResponse = z.infer<typeof MonthlyInterestInstanceResponse>;
export const MonthlyInterestInstanceListResponse = z.array(MonthlyInterestInstanceResponse);

export function useAllMonthlyInterestInstances() {
  return useQuery({
    queryKey: ["workflow_instances", "monthly_interest"],
    queryFn: async () => {
      const r = await api.get(`/workflows/monthly_interest/instances`);
      return MonthlyInterestInstanceListResponse.parse(r);
    },
  });
}

export function useMonthlyInterestInstanceById(id: string | undefined) {
  return useQuery({
    queryKey: [...["workflow_instances", "monthly_interest"], id],
    enabled: !!id,
    queryFn: async () => {
      const r = await api.get(`/workflows/monthly_interest/instances/${seg(id)}`);
      return MonthlyInterestInstanceResponse.parse(r);
    },
  });
}

export const OpenAccountRequest = z.object({
  owner: z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/),
  number: z.string(),
  accountType: AccountTypeSchema,
  currency: z.string(),
});
export type OpenAccountRequest = z.infer<typeof OpenAccountRequest>;

export function useOpenAccountWorkflow() {
  return useMutation({
    mutationFn: async (input: OpenAccountRequest) => {
      await api.post(`/workflows/open_account`, input);
    },
  });
}

export const RequestLargeTransferRequest = z.object({
  sourceAccount: z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/),
  targetAccount: z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/),
  amount: moneySchema,
  reference: z.string(),
});
export type RequestLargeTransferRequest = z.infer<typeof RequestLargeTransferRequest>;
/** Pre-parse form shape (z.input) — money fields are decimal strings. */
export type RequestLargeTransferFormState = z.input<typeof RequestLargeTransferRequest>;
/** Post-parse payload shape (z.output) — money fields are Decimal. */
export type RequestLargeTransferPayload = z.output<typeof RequestLargeTransferRequest>;

export function useRequestLargeTransferWorkflow() {
  return useMutation({
    mutationFn: async (input: RequestLargeTransferRequest) => {
      await api.post(`/workflows/request_large_transfer`, input);
    },
  });
}

export const TransferRequest = z.object({
  sourceAccount: z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/),
  targetAccount: z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/),
  amount: moneySchema,
  reference: z.string(),
});
export type TransferRequest = z.infer<typeof TransferRequest>;
/** Pre-parse form shape (z.input) — money fields are decimal strings. */
export type TransferFormState = z.input<typeof TransferRequest>;
/** Post-parse payload shape (z.output) — money fields are Decimal. */
export type TransferPayload = z.output<typeof TransferRequest>;

export function useTransferWorkflow() {
  return useMutation({
    mutationFn: async (input: TransferRequest) => {
      await api.post(`/workflows/transfer`, input);
    },
  });
}

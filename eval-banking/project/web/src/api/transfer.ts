// Auto-generated.  Do not edit by hand.
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, seg } from "./client";
import { moneySchema } from "../lib/schemas";

export const TransferStatusSchema = z.enum(["Pending", "Completed", "Rejected"]);


export const MarkCompletedTransferRequest = z.object({
});
export type MarkCompletedTransferRequest = z.infer<typeof MarkCompletedTransferRequest>;
export const RejectTransferRequest = z.object({
  reason: z.string(),
});
export type RejectTransferRequest = z.infer<typeof RejectTransferRequest>;

export const PendingQuery = z.object({
});
export type PendingQuery = z.infer<typeof PendingQuery>;

export const TransferResponse = z.object({
  id: z.string(),
  reference: z.string(),
  source: z.string(),
  target: z.string(),
  amount: moneySchema,
  status: TransferStatusSchema,
  requestedBy: z.string(),
  requestedAt: z.string(),
  decidedBy: z.string().nullish().nullish(),
  version: z.number().int(),
  display: z.string(),
});
export type TransferResponse = z.infer<typeof TransferResponse>;
export const TransferListResponse = z.array(TransferResponse);
export type TransferListResponse = z.infer<typeof TransferListResponse>;

export function useAllTransfers() {
  return useQuery({
    queryKey: ["transfers"],
    queryFn: async () => {
      const r = await api.get(`/transfers`);
      return TransferListResponse.parse(r);
    },
  });
}

export function useTransferById(id: string | undefined) {
  return useQuery({
    queryKey: ["transfers", id],
    enabled: !!id,
    queryFn: async () => {
      const r = await api.get(`/transfers/${seg(id)}`);
      return TransferResponse.parse(r);
    },
  });
}

export function useMarkCompletedTransfer(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: MarkCompletedTransferRequest) => {
      await api.post(`/transfers/${seg(id)}/mark_completed`, input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transfers", id] });
      qc.invalidateQueries({ queryKey: ["transfers"] });
    },
  });
}

export function useRejectTransfer(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: RejectTransferRequest) => {
      await api.post(`/transfers/${seg(id)}/reject`, input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transfers", id] });
      qc.invalidateQueries({ queryKey: ["transfers"] });
    },
  });
}

export function usePendingTransfer(query: PendingQuery = {}) {
  return useQuery({
    queryKey: ["transfers", "find", "pending", query],
    queryFn: async () => {
      const qs = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString();
      const r = await api.get(`/transfers/pending${qs ? "?" + qs : ""}`);
      return TransferListResponse.parse(r);
    },
  });
}

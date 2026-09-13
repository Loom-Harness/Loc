// Auto-generated.  Do not edit by hand.
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, seg } from "./client";


export const CreateInvoiceRequest = z.object({
  workOrderId: z.string().uuid(),
  customerId: z.string().uuid(),
  currency: z.string(),
  amount: z.number().min(0, { message: "Amount must be at least 0" }),
  issued: z.boolean(),
});
export type CreateInvoiceRequest = z.infer<typeof CreateInvoiceRequest>;

export const IssueInvoiceRequest = z.object({
});
export type IssueInvoiceRequest = z.infer<typeof IssueInvoiceRequest>;
export const UpdateInvoiceRequest = z.object({
  workOrderId: z.string().uuid(),
  customerId: z.string().uuid(),
  currency: z.string(),
  amount: z.number().min(0, { message: "Amount must be at least 0" }),
  issued: z.boolean(),
});
export type UpdateInvoiceRequest = z.infer<typeof UpdateInvoiceRequest>;

export const AllQuery = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  sort: z.string().default("id"),
  dir: z.string().default("asc"),
});
export type AllQuery = z.infer<typeof AllQuery>;
export type AllQueryInput = z.input<typeof AllQuery>;

export const InvoiceResponse = z.object({
  id: z.string(),
  workOrderId: z.string(),
  customerId: z.string(),
  currency: z.string(),
  amount: z.number(),
  issued: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: z.string(),
  updatedBy: z.string(),
  version: z.number().int(),
});
export type InvoiceResponse = z.infer<typeof InvoiceResponse>;
export const InvoiceListResponse = z.array(InvoiceResponse);
export type InvoiceListResponse = z.infer<typeof InvoiceListResponse>;
export const InvoicePaged = z.object({ items: z.array(InvoiceResponse), page: z.number().int(), pageSize: z.number().int(), total: z.number().int(), totalPages: z.number().int() });
export type InvoicePaged = z.infer<typeof InvoicePaged>;

export function useAllInvoices(query: AllQueryInput = {}) {
  const q = AllQuery.parse(query);
  return useQuery({
    queryKey: ["invoices", "list", q],
    queryFn: async () => {
      const qs = new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)])).toString();
      const r = await api.get(`/invoices${qs ? "?" + qs : ""}`);
      return InvoicePaged.parse(r);
    },
  });
}

export function useInvoiceById(id: string | undefined) {
  return useQuery({
    queryKey: ["invoices", id],
    enabled: !!id,
    queryFn: async () => {
      const r = await api.get(`/invoices/${seg(id)}`);
      return InvoiceResponse.parse(r);
    },
  });
}

export function useCreateInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateInvoiceRequest) => {
      const r = await api.post(`/invoices`, input);
      return z.object({ id: z.string() }).parse(r);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoices"] }),
  });
}

export function useDeleteInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/invoices/${seg(id)}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoices"] }),
  });
}

export function useIssueInvoice(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: IssueInvoiceRequest) => {
      await api.post(`/invoices/${seg(id)}/issue`, input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices", id] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
    },
  });
}

export function useUpdateInvoice(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateInvoiceRequest) => {
      await api.post(`/invoices/${seg(id)}/update`, input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices", id] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
    },
  });
}

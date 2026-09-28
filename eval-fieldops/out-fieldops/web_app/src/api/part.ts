// Auto-generated.  Do not edit by hand.
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, seg } from "./client";
import { moneySchema } from "../lib/schemas";


export const CreatePartRequest = z.object({
  sku: z.string(),
  binCode: z.string(),
  onHand: z.number().int().min(0, { message: "On Hand must be at least 0" }),
  unitPrice: moneySchema,
  currency: z.string(),
});
export type CreatePartRequest = z.infer<typeof CreatePartRequest>;
/** Pre-parse form shape (z.input) — money fields are decimal strings. */
export type CreatePartFormState = z.input<typeof CreatePartRequest>;
/** Post-parse payload shape (z.output) — money fields are Decimal. */
export type CreatePartPayload = z.output<typeof CreatePartRequest>;

export const ConsumePartRequest = z.object({
  qty: z.number().int().min(1, { message: "Qty must be at least 1" }),
});
export type ConsumePartRequest = z.infer<typeof ConsumePartRequest>;
export const UpdatePartRequest = z.object({
  sku: z.string(),
  binCode: z.string(),
  onHand: z.number().int().min(0, { message: "On Hand must be at least 0" }),
  unitPrice: moneySchema,
  currency: z.string(),
});
export type UpdatePartRequest = z.infer<typeof UpdatePartRequest>;
/** Pre-parse form shape (z.input) — money fields are decimal strings. */
export type UpdatePartFormState = z.input<typeof UpdatePartRequest>;
/** Post-parse payload shape (z.output) — money fields are Decimal. */
export type UpdatePartPayload = z.output<typeof UpdatePartRequest>;

export const AllQuery = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  sort: z.string().default("id"),
  dir: z.string().default("asc"),
});
export type AllQuery = z.infer<typeof AllQuery>;
export type AllQueryInput = z.input<typeof AllQuery>;

export const PartResponse = z.object({
  id: z.string(),
  sku: z.string(),
  binCode: z.string(),
  onHand: z.number().int(),
  unitPrice: moneySchema,
  currency: z.string(),
  version: z.number().int(),
  display: z.string(),
});
export type PartResponse = z.infer<typeof PartResponse>;
export const PartListResponse = z.array(PartResponse);
export type PartListResponse = z.infer<typeof PartListResponse>;
export const PartPaged = z.object({ items: z.array(PartResponse), page: z.number().int(), pageSize: z.number().int(), total: z.number().int(), totalPages: z.number().int() });
export type PartPaged = z.infer<typeof PartPaged>;

export function useAllParts(query: AllQueryInput = {}) {
  const q = AllQuery.parse(query);
  return useQuery({
    queryKey: ["parts", "list", q],
    queryFn: async () => {
      const qs = new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)])).toString();
      const r = await api.get(`/parts${qs ? "?" + qs : ""}`);
      return PartPaged.parse(r);
    },
  });
}

export function usePartById(id: string | undefined) {
  return useQuery({
    queryKey: ["parts", id],
    enabled: !!id,
    queryFn: async () => {
      const r = await api.get(`/parts/${seg(id)}`);
      return PartResponse.parse(r);
    },
  });
}

export function useCreatePart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreatePartRequest) => {
      const r = await api.post(`/parts`, input);
      return z.object({ id: z.string() }).parse(r);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["parts"] }),
  });
}

export function useDeletePart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/parts/${seg(id)}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["parts"] }),
  });
}

export function useConsumePart(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ConsumePartRequest) => {
      await api.post(`/parts/${seg(id)}/consume`, input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["parts", id] });
      qc.invalidateQueries({ queryKey: ["parts"] });
    },
  });
}

export function useUpdatePart(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdatePartRequest) => {
      await api.post(`/parts/${seg(id)}/update`, input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["parts", id] });
      qc.invalidateQueries({ queryKey: ["parts"] });
    },
  });
}

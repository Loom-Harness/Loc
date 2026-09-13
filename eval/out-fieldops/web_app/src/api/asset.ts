// Auto-generated.  Do not edit by hand.
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, seg } from "./client";


export const CreateAssetRequest = z.object({
  siteId: z.string().uuid(),
  requiredSkill: z.string(),
  serialNumber: z.string(),
  model: z.string(),
  warrantyExpiry: z.string(),
});
export type CreateAssetRequest = z.infer<typeof CreateAssetRequest>;

export const UpdateAssetRequest = z.object({
  siteId: z.string().uuid(),
  requiredSkill: z.string(),
  serialNumber: z.string(),
  model: z.string(),
  warrantyExpiry: z.string(),
});
export type UpdateAssetRequest = z.infer<typeof UpdateAssetRequest>;

export const AllQuery = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  sort: z.string().default("id"),
  dir: z.string().default("asc"),
});
export type AllQuery = z.infer<typeof AllQuery>;
export type AllQueryInput = z.input<typeof AllQuery>;

export const AssetResponse = z.object({
  id: z.string(),
  siteId: z.string(),
  requiredSkill: z.string(),
  serialNumber: z.string(),
  model: z.string(),
  warrantyExpiry: z.string(),
  version: z.number().int(),
  display: z.string(),
});
export type AssetResponse = z.infer<typeof AssetResponse>;
export const AssetListResponse = z.array(AssetResponse);
export type AssetListResponse = z.infer<typeof AssetListResponse>;
export const AssetPaged = z.object({ items: z.array(AssetResponse), page: z.number().int(), pageSize: z.number().int(), total: z.number().int(), totalPages: z.number().int() });
export type AssetPaged = z.infer<typeof AssetPaged>;

export function useAllAssets(query: AllQueryInput = {}) {
  const q = AllQuery.parse(query);
  return useQuery({
    queryKey: ["assets", "list", q],
    queryFn: async () => {
      const qs = new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)])).toString();
      const r = await api.get(`/assets${qs ? "?" + qs : ""}`);
      return AssetPaged.parse(r);
    },
  });
}

export function useAssetById(id: string | undefined) {
  return useQuery({
    queryKey: ["assets", id],
    enabled: !!id,
    queryFn: async () => {
      const r = await api.get(`/assets/${seg(id)}`);
      return AssetResponse.parse(r);
    },
  });
}

export function useCreateAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateAssetRequest) => {
      const r = await api.post(`/assets`, input);
      return z.object({ id: z.string() }).parse(r);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assets"] }),
  });
}

export function useDeleteAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/assets/${seg(id)}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assets"] }),
  });
}

export function useUpdateAsset(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateAssetRequest) => {
      await api.post(`/assets/${seg(id)}/update`, input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assets", id] });
      qc.invalidateQueries({ queryKey: ["assets"] });
    },
  });
}

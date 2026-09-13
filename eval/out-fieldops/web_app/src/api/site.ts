// Auto-generated.  Do not edit by hand.
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, seg } from "./client";


export const CreateSiteRequest = z.object({
  customerId: z.string().uuid(),
  label: z.string(),
  addressLine: z.string(),
  city: z.string(),
});
export type CreateSiteRequest = z.infer<typeof CreateSiteRequest>;

export const UpdateSiteRequest = z.object({
  customerId: z.string().uuid(),
  label: z.string(),
  addressLine: z.string(),
  city: z.string(),
});
export type UpdateSiteRequest = z.infer<typeof UpdateSiteRequest>;

export const AllQuery = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  sort: z.string().default("id"),
  dir: z.string().default("asc"),
});
export type AllQuery = z.infer<typeof AllQuery>;
export type AllQueryInput = z.input<typeof AllQuery>;

export const SiteResponse = z.object({
  id: z.string(),
  customerId: z.string(),
  label: z.string(),
  addressLine: z.string(),
  city: z.string(),
  version: z.number().int(),
  display: z.string(),
});
export type SiteResponse = z.infer<typeof SiteResponse>;
export const SiteListResponse = z.array(SiteResponse);
export type SiteListResponse = z.infer<typeof SiteListResponse>;
export const SitePaged = z.object({ items: z.array(SiteResponse), page: z.number().int(), pageSize: z.number().int(), total: z.number().int(), totalPages: z.number().int() });
export type SitePaged = z.infer<typeof SitePaged>;

export function useAllSites(query: AllQueryInput = {}) {
  const q = AllQuery.parse(query);
  return useQuery({
    queryKey: ["sites", "list", q],
    queryFn: async () => {
      const qs = new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)])).toString();
      const r = await api.get(`/sites${qs ? "?" + qs : ""}`);
      return SitePaged.parse(r);
    },
  });
}

export function useSiteById(id: string | undefined) {
  return useQuery({
    queryKey: ["sites", id],
    enabled: !!id,
    queryFn: async () => {
      const r = await api.get(`/sites/${seg(id)}`);
      return SiteResponse.parse(r);
    },
  });
}

export function useCreateSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateSiteRequest) => {
      const r = await api.post(`/sites`, input);
      return z.object({ id: z.string() }).parse(r);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sites"] }),
  });
}

export function useDeleteSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/sites/${seg(id)}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sites"] }),
  });
}

export function useUpdateSite(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateSiteRequest) => {
      await api.post(`/sites/${seg(id)}/update`, input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sites", id] });
      qc.invalidateQueries({ queryKey: ["sites"] });
    },
  });
}

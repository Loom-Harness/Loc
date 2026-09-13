// Auto-generated.  Do not edit by hand.
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, seg } from "./client";


export const CreateOrganizationRequest = z.object({
  name: z.string(),
});
export type CreateOrganizationRequest = z.infer<typeof CreateOrganizationRequest>;

export const UpdateOrganizationRequest = z.object({
  name: z.string(),
});
export type UpdateOrganizationRequest = z.infer<typeof UpdateOrganizationRequest>;

export const AllQuery = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  sort: z.string().default("id"),
  dir: z.string().default("asc"),
});
export type AllQuery = z.infer<typeof AllQuery>;
export type AllQueryInput = z.input<typeof AllQuery>;

export const OrganizationResponse = z.object({
  id: z.string(),
  name: z.string(),
  version: z.number().int(),
  display: z.string(),
});
export type OrganizationResponse = z.infer<typeof OrganizationResponse>;
export const OrganizationListResponse = z.array(OrganizationResponse);
export type OrganizationListResponse = z.infer<typeof OrganizationListResponse>;
export const OrganizationPaged = z.object({ items: z.array(OrganizationResponse), page: z.number().int(), pageSize: z.number().int(), total: z.number().int(), totalPages: z.number().int() });
export type OrganizationPaged = z.infer<typeof OrganizationPaged>;

export function useAllOrganizations(query: AllQueryInput = {}) {
  const q = AllQuery.parse(query);
  return useQuery({
    queryKey: ["organizations", "list", q],
    queryFn: async () => {
      const qs = new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)])).toString();
      const r = await api.get(`/organizations${qs ? "?" + qs : ""}`);
      return OrganizationPaged.parse(r);
    },
  });
}

export function useOrganizationById(id: string | undefined) {
  return useQuery({
    queryKey: ["organizations", id],
    enabled: !!id,
    queryFn: async () => {
      const r = await api.get(`/organizations/${seg(id)}`);
      return OrganizationResponse.parse(r);
    },
  });
}

export function useCreateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateOrganizationRequest) => {
      const r = await api.post(`/organizations`, input);
      return z.object({ id: z.string() }).parse(r);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["organizations"] }),
  });
}

export function useDeleteOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/organizations/${seg(id)}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["organizations"] }),
  });
}

export function useUpdateOrganization(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateOrganizationRequest) => {
      await api.post(`/organizations/${seg(id)}/update`, input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["organizations", id] });
      qc.invalidateQueries({ queryKey: ["organizations"] });
    },
  });
}

// Auto-generated.  Do not edit by hand.
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, seg } from "./client";


export const CreateTechnicianRequest = z.object({
  userId: z.string(),
  name: z.string(),
  skills: z.array(z.string()),
  costRatePerHour: z.number(),
});
export type CreateTechnicianRequest = z.infer<typeof CreateTechnicianRequest>;

export const UpdateTechnicianRequest = z.object({
  userId: z.string(),
  name: z.string(),
  skills: z.array(z.string()),
  costRatePerHour: z.number(),
});
export type UpdateTechnicianRequest = z.infer<typeof UpdateTechnicianRequest>;

export const AllQuery = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  sort: z.string().default("id"),
  dir: z.string().default("asc"),
});
export type AllQuery = z.infer<typeof AllQuery>;
export type AllQueryInput = z.input<typeof AllQuery>;

export const TechnicianResponse = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  skills: z.array(z.string()),
  costRatePerHour: z.number(),
  version: z.number().int(),
  display: z.string(),
});
export type TechnicianResponse = z.infer<typeof TechnicianResponse>;
export const TechnicianListResponse = z.array(TechnicianResponse);
export type TechnicianListResponse = z.infer<typeof TechnicianListResponse>;
export const TechnicianPaged = z.object({ items: z.array(TechnicianResponse), page: z.number().int(), pageSize: z.number().int(), total: z.number().int(), totalPages: z.number().int() });
export type TechnicianPaged = z.infer<typeof TechnicianPaged>;

export function useAllTechnicians(query: AllQueryInput = {}) {
  const q = AllQuery.parse(query);
  return useQuery({
    queryKey: ["technicians", "list", q],
    queryFn: async () => {
      const qs = new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)])).toString();
      const r = await api.get(`/technicians${qs ? "?" + qs : ""}`);
      return TechnicianPaged.parse(r);
    },
  });
}

export function useTechnicianById(id: string | undefined) {
  return useQuery({
    queryKey: ["technicians", id],
    enabled: !!id,
    queryFn: async () => {
      const r = await api.get(`/technicians/${seg(id)}`);
      return TechnicianResponse.parse(r);
    },
  });
}

export function useCreateTechnician() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateTechnicianRequest) => {
      const r = await api.post(`/technicians`, input);
      return z.object({ id: z.string() }).parse(r);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["technicians"] }),
  });
}

export function useDeleteTechnician() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/technicians/${seg(id)}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["technicians"] }),
  });
}

export function useUpdateTechnician(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateTechnicianRequest) => {
      await api.post(`/technicians/${seg(id)}/update`, input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["technicians", id] });
      qc.invalidateQueries({ queryKey: ["technicians"] });
    },
  });
}

// Auto-generated.  Do not edit by hand.
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, seg } from "./client";


export const CreateProjectRequest = z.object({
  name: z.string().refine((s) => [...s].length >= 1, { message: "Name must be at least 1 character" }),
});
export type CreateProjectRequest = z.infer<typeof CreateProjectRequest>;

export const UpdateProjectRequest = z.object({
  name: z.string().refine((s) => [...s].length >= 1, { message: "Name must be at least 1 character" }),
});
export type UpdateProjectRequest = z.infer<typeof UpdateProjectRequest>;

export const AllQuery = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  sort: z.string().default("id"),
  dir: z.string().default("asc"),
});
export type AllQuery = z.infer<typeof AllQuery>;
export type AllQueryInput = z.input<typeof AllQuery>;

export const ProjectResponse = z.object({
  id: z.string(),
  name: z.string(),
  version: z.number().int(),
  display: z.string(),
});
export type ProjectResponse = z.infer<typeof ProjectResponse>;
export const ProjectListResponse = z.array(ProjectResponse);
export type ProjectListResponse = z.infer<typeof ProjectListResponse>;
export const ProjectPaged = z.object({ items: z.array(ProjectResponse), page: z.number().int(), pageSize: z.number().int(), total: z.number().int(), totalPages: z.number().int() });
export type ProjectPaged = z.infer<typeof ProjectPaged>;

export function useAllProjects(query: AllQueryInput = {}) {
  const q = AllQuery.parse(query);
  return useQuery({
    queryKey: ["projects", "list", q],
    queryFn: async () => {
      const qs = new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)])).toString();
      const r = await api.get(`/projects${qs ? "?" + qs : ""}`);
      return ProjectPaged.parse(r);
    },
  });
}

export function useProjectById(id: string | undefined) {
  return useQuery({
    queryKey: ["projects", id],
    enabled: !!id,
    queryFn: async () => {
      const r = await api.get(`/projects/${seg(id)}`);
      return ProjectResponse.parse(r);
    },
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateProjectRequest) => {
      const r = await api.post(`/projects`, input);
      return z.object({ id: z.string() }).parse(r);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/projects/${seg(id)}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useUpdateProject(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateProjectRequest) => {
      await api.post(`/projects/${seg(id)}/update`, input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects", id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

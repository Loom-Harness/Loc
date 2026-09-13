// Auto-generated.  Do not edit by hand.
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, seg } from "./client";


export const CreateTaskRequest = z.object({
  title: z.string(),
  done: z.boolean(),
  project: z.string().uuid(),
});
export type CreateTaskRequest = z.infer<typeof CreateTaskRequest>;

export const UpdateTaskRequest = z.object({
  title: z.string(),
  done: z.boolean(),
  project: z.string().uuid(),
});
export type UpdateTaskRequest = z.infer<typeof UpdateTaskRequest>;

export const AllQuery = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  sort: z.string().default("id"),
  dir: z.string().default("asc"),
});
export type AllQuery = z.infer<typeof AllQuery>;
export type AllQueryInput = z.input<typeof AllQuery>;
export const ByProjectQuery = z.object({
  projectId: z.string().uuid(),
});
export type ByProjectQuery = z.infer<typeof ByProjectQuery>;

export const TaskResponse = z.object({
  id: z.string(),
  title: z.string(),
  done: z.boolean(),
  project: z.string(),
  version: z.number().int(),
});
export type TaskResponse = z.infer<typeof TaskResponse>;
export const TaskListResponse = z.array(TaskResponse);
export type TaskListResponse = z.infer<typeof TaskListResponse>;
export const TaskPaged = z.object({ items: z.array(TaskResponse), page: z.number().int(), pageSize: z.number().int(), total: z.number().int(), totalPages: z.number().int() });
export type TaskPaged = z.infer<typeof TaskPaged>;

export function useAllTasks(query: AllQueryInput = {}) {
  const q = AllQuery.parse(query);
  return useQuery({
    queryKey: ["tasks", "list", q],
    queryFn: async () => {
      const qs = new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)])).toString();
      const r = await api.get(`/tasks${qs ? "?" + qs : ""}`);
      return TaskPaged.parse(r);
    },
  });
}

export function useTaskById(id: string | undefined) {
  return useQuery({
    queryKey: ["tasks", id],
    enabled: !!id,
    queryFn: async () => {
      const r = await api.get(`/tasks/${seg(id)}`);
      return TaskResponse.parse(r);
    },
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateTaskRequest) => {
      const r = await api.post(`/tasks`, input);
      return z.object({ id: z.string() }).parse(r);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/tasks/${seg(id)}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
}

export function useUpdateTask(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateTaskRequest) => {
      await api.post(`/tasks/${seg(id)}/update`, input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks", id] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function useByProjectTask(query: ByProjectQuery) {
  return useQuery({
    queryKey: ["tasks", "find", "by_project", query],
    queryFn: async () => {
      const qs = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString();
      const r = await api.get(`/tasks/by_project${qs ? "?" + qs : ""}`);
      return TaskListResponse.parse(r);
    },
  });
}

// Auto-generated.  Do not edit by hand.
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ifMatch, seg } from "./client";

export const StatusSchema = z.enum(["Draft", "Done"]);

export const CreateTaskRequest = z.object({
  title: z.string(),
  status: StatusSchema,
});
export type CreateTaskRequest = z.infer<typeof CreateTaskRequest>;

export const CompleteTaskRequest = z.object({
});
export type CompleteTaskRequest = z.infer<typeof CompleteTaskRequest>;
export const UpdateTaskRequest = z.object({
  title: z.string(),
  status: StatusSchema,
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

export const TaskResponse = z.object({
  id: z.string(),
  title: z.string(),
  status: StatusSchema,
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

export function useCompleteTask(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CompleteTaskRequest) => {
      await api.post(`/tasks/${seg(id)}/complete`, input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks", id] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function useUpdateTask(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateTaskRequest) => {
      const loaded = qc.getQueryData<TaskResponse>(["tasks", id]);
      await api.post(`/tasks/${seg(id)}/update`, input, ifMatch(loaded?.version));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks", id] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

// Auto-generated.  Do not edit by hand.
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, seg } from "./client";
import { moneySchema } from "../lib/schemas";

export const WorkOrderStatusSchema = z.enum(["Draft", "Scheduled", "InProgress", "Completed", "Cancelled"]);
export const PrioritySchema = z.enum(["Low", "Normal", "High", "Urgent"]);

export const CreateWorkOrderRequest = z.object({
  customerId: z.string().uuid(),
  siteId: z.string().uuid(),
  assetId: z.string().uuid().nullish(),
  technicianId: z.string().uuid().nullish(),
  technicianUserId: z.string().nullish(),
  status: WorkOrderStatusSchema,
  priority: PrioritySchema,
  currency: z.string().refine((s) => [...s].length === 3, { message: "Currency must be exactly 3 characters" }),
  scheduledAt: z.string().nullish(),
  startedAt: z.string().nullish(),
  completedAt: z.string().nullish(),
  resolutionNote: z.string().nullish(),
  photo: z.object({ url: z.string(), key: z.string(), contentType: z.string(), size: z.number().int() }).nullable().nullish(),
});
export type CreateWorkOrderRequest = z.infer<typeof CreateWorkOrderRequest>;

export const AddLabourWorkOrderRequest = z.object({
  description: z.string(),
  hours: z.number().gt(0, { message: "Hours must be greater than 0" }),
  rate: moneySchema,
  lineCurrency: z.string(),
});
export type AddLabourWorkOrderRequest = z.infer<typeof AddLabourWorkOrderRequest>;
/** Pre-parse form shape (z.input) — money fields are decimal strings. */
export type AddLabourWorkOrderFormState = z.input<typeof AddLabourWorkOrderRequest>;
/** Post-parse payload shape (z.output) — money fields are Decimal. */
export type AddLabourWorkOrderPayload = z.output<typeof AddLabourWorkOrderRequest>;
export const ScheduleWorkOrderRequest = z.object({
  tech: z.string().uuid(),
  at: z.string(),
});
export type ScheduleWorkOrderRequest = z.infer<typeof ScheduleWorkOrderRequest>;
export const StartWorkOrderRequest = z.object({
});
export type StartWorkOrderRequest = z.infer<typeof StartWorkOrderRequest>;
export const CompleteWorkOrderRequest = z.object({
  note: z.string(),
});
export type CompleteWorkOrderRequest = z.infer<typeof CompleteWorkOrderRequest>;
export const CancelWorkOrderRequest = z.object({
  reason: z.string(),
});
export type CancelWorkOrderRequest = z.infer<typeof CancelWorkOrderRequest>;

export const AllQuery = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  sort: z.string().default("id"),
  dir: z.string().default("asc"),
});
export type AllQuery = z.infer<typeof AllQuery>;
export type AllQueryInput = z.input<typeof AllQuery>;

export const WorkOrderLineResponse = z.object({
  id: z.string(),
  description: z.string(),
  quantity: z.number(),
  unitPrice: moneySchema,
  currency: z.string(),
  amount: moneySchema,
});
export type WorkOrderLineResponse = z.infer<typeof WorkOrderLineResponse>;
export const WorkOrderResponse = z.object({
  id: z.string(),
  customerId: z.string(),
  siteId: z.string(),
  assetId: z.string().nullish().nullish(),
  technicianId: z.string().nullish().nullish(),
  technicianUserId: z.string().nullish().nullish(),
  status: WorkOrderStatusSchema,
  priority: PrioritySchema,
  currency: z.string(),
  scheduledAt: z.string().nullish().nullish(),
  startedAt: z.string().nullish().nullish(),
  completedAt: z.string().nullish().nullish(),
  resolutionNote: z.string().nullish().nullish(),
  photo: z.object({ url: z.string(), key: z.string(), contentType: z.string(), size: z.number().int() }).nullish().nullish(),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: z.string(),
  updatedBy: z.string(),
  version: z.number().int(),
  lines: z.array(WorkOrderLineResponse),
  total: moneySchema,
  display: z.string(),
  timeToComplete: z.number().int(),
});
export type WorkOrderResponse = z.infer<typeof WorkOrderResponse>;
export const WorkOrderListResponse = z.array(WorkOrderResponse);
export type WorkOrderListResponse = z.infer<typeof WorkOrderListResponse>;
export const WorkOrderPaged = z.object({ items: z.array(WorkOrderResponse), page: z.number().int(), pageSize: z.number().int(), total: z.number().int(), totalPages: z.number().int() });
export type WorkOrderPaged = z.infer<typeof WorkOrderPaged>;

export function useAllWorkOrders(query: AllQueryInput = {}) {
  const q = AllQuery.parse(query);
  return useQuery({
    queryKey: ["work_orders", "list", q],
    queryFn: async () => {
      const qs = new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)])).toString();
      const r = await api.get(`/work_orders${qs ? "?" + qs : ""}`);
      return WorkOrderPaged.parse(r);
    },
  });
}

export function useWorkOrderById(id: string | undefined) {
  return useQuery({
    queryKey: ["work_orders", id],
    enabled: !!id,
    queryFn: async () => {
      const r = await api.get(`/work_orders/${seg(id)}`);
      return WorkOrderResponse.parse(r);
    },
  });
}

export function useCreateWorkOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateWorkOrderRequest) => {
      const r = await api.post(`/work_orders`, input);
      return z.object({ id: z.string() }).parse(r);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["work_orders"] }),
  });
}

export function useAddLabourWorkOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AddLabourWorkOrderRequest) => {
      await api.post(`/work_orders/${seg(id)}/add_labour`, input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["work_orders", id] });
      qc.invalidateQueries({ queryKey: ["work_orders"] });
    },
  });
}

export function useScheduleWorkOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ScheduleWorkOrderRequest) => {
      await api.post(`/work_orders/${seg(id)}/schedule`, input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["work_orders", id] });
      qc.invalidateQueries({ queryKey: ["work_orders"] });
    },
  });
}

export function useStartWorkOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: StartWorkOrderRequest) => {
      await api.post(`/work_orders/${seg(id)}/start`, input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["work_orders", id] });
      qc.invalidateQueries({ queryKey: ["work_orders"] });
    },
  });
}

export function useCompleteWorkOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CompleteWorkOrderRequest) => {
      await api.post(`/work_orders/${seg(id)}/complete`, input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["work_orders", id] });
      qc.invalidateQueries({ queryKey: ["work_orders"] });
    },
  });
}

export function useCancelWorkOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CancelWorkOrderRequest) => {
      await api.post(`/work_orders/${seg(id)}/cancel`, input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["work_orders", id] });
      qc.invalidateQueries({ queryKey: ["work_orders"] });
    },
  });
}

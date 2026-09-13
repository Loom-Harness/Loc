// Auto-generated.  Do not edit by hand.
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, seg } from "./client";

export const WorkOrderStatusSchema = z.enum(["Draft", "Scheduled", "InProgress", "Completed", "Cancelled"]);
export const PrioritySchema = z.enum(["Low", "Normal", "High", "Urgent"]);
export const LineKindSchema = z.enum(["Labour", "Parts"]);
export const MoneySchema = z.object({
  amount: z.number().min(0, { message: "Amount must be at least 0" }),
  currency: z.string().refine((s) => [...s].length === 3, { message: "Currency must be exactly 3 characters" }),
});

export const CreateWorkOrderRequest = z.object({
  customerId: z.string().uuid(),
  siteId: z.string().uuid(),
  assetId: z.string().uuid().nullish(),
  technicianId: z.string().uuid().nullish(),
  technicianUserId: z.string().nullish(),
  status: WorkOrderStatusSchema,
  priority: PrioritySchema,
  currency: z.string(),
  scheduledAt: z.string().nullish(),
  startedAt: z.string().nullish(),
  completedAt: z.string().nullish(),
  resolutionNote: z.string().nullish(),
});
export type CreateWorkOrderRequest = z.infer<typeof CreateWorkOrderRequest>;

export const AssignTechnicianWorkOrderRequest = z.object({
  assignTo: z.string().uuid(),
  assignedUserId: z.string(),
  at: z.string(),
});
export type AssignTechnicianWorkOrderRequest = z.infer<typeof AssignTechnicianWorkOrderRequest>;
export const StartWorkOrderRequest = z.object({
});
export type StartWorkOrderRequest = z.infer<typeof StartWorkOrderRequest>;
export const AddLineWorkOrderRequest = z.object({
  kind: LineKindSchema,
  description: z.string(),
  partId: z.string().uuid().nullish(),
  quantity: z.number().int().min(1, { message: "Quantity must be at least 1" }),
  unitPrice: MoneySchema,
});
export type AddLineWorkOrderRequest = z.infer<typeof AddLineWorkOrderRequest>;
export const CompleteWorkOrderRequest = z.object({
  note: z.string(),
});
export type CompleteWorkOrderRequest = z.infer<typeof CompleteWorkOrderRequest>;
export const CancelWorkOrderRequest = z.object({
});
export type CancelWorkOrderRequest = z.infer<typeof CancelWorkOrderRequest>;
export const NotifyCustomerWorkOrderRequest = z.object({
});
export type NotifyCustomerWorkOrderRequest = z.infer<typeof NotifyCustomerWorkOrderRequest>;
export const AttachPhotoWorkOrderRequest = z.object({
  file: z.object({ url: z.string(), key: z.string(), contentType: z.string(), size: z.number().int() }).nullable(),
  caption: z.string(),
});
export type AttachPhotoWorkOrderRequest = z.infer<typeof AttachPhotoWorkOrderRequest>;
export const UpdateWorkOrderRequest = z.object({
  customerId: z.string().uuid(),
  siteId: z.string().uuid(),
  assetId: z.string().uuid().nullish(),
  technicianId: z.string().uuid().nullish(),
  technicianUserId: z.string().nullish(),
  status: WorkOrderStatusSchema,
  priority: PrioritySchema,
  currency: z.string(),
  scheduledAt: z.string().nullish(),
  startedAt: z.string().nullish(),
  completedAt: z.string().nullish(),
  resolutionNote: z.string().nullish(),
});
export type UpdateWorkOrderRequest = z.infer<typeof UpdateWorkOrderRequest>;

export const AllQuery = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  sort: z.string().default("id"),
  dir: z.string().default("asc"),
});
export type AllQuery = z.infer<typeof AllQuery>;
export type AllQueryInput = z.input<typeof AllQuery>;
export const MineQuery = z.object({
});
export type MineQuery = z.infer<typeof MineQuery>;
export const AcrossAllTenantsQuery = z.object({
});
export type AcrossAllTenantsQuery = z.infer<typeof AcrossAllTenantsQuery>;

export const PhotoResponse = z.object({
  id: z.string(),
  file: z.object({ url: z.string(), key: z.string(), contentType: z.string(), size: z.number().int() }),
  caption: z.string(),
});
export type PhotoResponse = z.infer<typeof PhotoResponse>;
export const WorkOrderLineResponse = z.object({
  id: z.string(),
  kind: LineKindSchema,
  description: z.string(),
  partId: z.string().nullish().nullish(),
  quantity: z.number().int(),
  unitPrice: MoneySchema,
  subtotal: MoneySchema,
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
  version: z.number().int(),
  lines: z.array(WorkOrderLineResponse),
  photos: z.array(PhotoResponse),
  display: z.string(),
  total: MoneySchema,
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

export function useDeleteWorkOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/work_orders/${seg(id)}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["work_orders"] }),
  });
}

export function useAssignTechnicianWorkOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AssignTechnicianWorkOrderRequest) => {
      await api.post(`/work_orders/${seg(id)}/assign_technician`, input);
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

export function useAddLineWorkOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AddLineWorkOrderRequest) => {
      await api.post(`/work_orders/${seg(id)}/add_line`, input);
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

export function useNotifyCustomerWorkOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: NotifyCustomerWorkOrderRequest) => {
      await api.post(`/work_orders/${seg(id)}/notify_customer`, input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["work_orders", id] });
      qc.invalidateQueries({ queryKey: ["work_orders"] });
    },
  });
}

export function useAttachPhotoWorkOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AttachPhotoWorkOrderRequest) => {
      await api.post(`/work_orders/${seg(id)}/attach_photo`, input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["work_orders", id] });
      qc.invalidateQueries({ queryKey: ["work_orders"] });
    },
  });
}

export function useUpdateWorkOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateWorkOrderRequest) => {
      await api.post(`/work_orders/${seg(id)}/update`, input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["work_orders", id] });
      qc.invalidateQueries({ queryKey: ["work_orders"] });
    },
  });
}

export function useMineWorkOrder(query: MineQuery = {}) {
  return useQuery({
    queryKey: ["work_orders", "find", "mine", query],
    queryFn: async () => {
      const qs = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString();
      const r = await api.get(`/work_orders/mine${qs ? "?" + qs : ""}`);
      return WorkOrderListResponse.parse(r);
    },
  });
}

export function useAcrossAllTenantsWorkOrder(query: AcrossAllTenantsQuery = {}) {
  return useQuery({
    queryKey: ["work_orders", "find", "across_all_tenants", query],
    queryFn: async () => {
      const qs = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString();
      const r = await api.get(`/work_orders/across_all_tenants${qs ? "?" + qs : ""}`);
      return WorkOrderListResponse.parse(r);
    },
  });
}

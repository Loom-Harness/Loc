// Auto-generated.  Do not edit by hand.
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { api } from "./client";

export const CompleteAndConsumePartRequest = z.object({
  workOrderId: z.string().uuid(),
  note: z.string(),
  partId: z.string().uuid(),
  qty: z.number().int(),
});
export type CompleteAndConsumePartRequest = z.infer<typeof CompleteAndConsumePartRequest>;

export function useCompleteAndConsumePartWorkflow() {
  return useMutation({
    mutationFn: async (input: CompleteAndConsumePartRequest) => {
      await api.post(`/workflows/complete_and_consume_part`, input);
    },
  });
}

export const ScheduleWorkOrderRequest = z.object({
  workOrderId: z.string().uuid(),
  assignTo: z.string().uuid(),
  at: z.string(),
});
export type ScheduleWorkOrderRequest = z.infer<typeof ScheduleWorkOrderRequest>;

export function useScheduleWorkOrderWorkflow() {
  return useMutation({
    mutationFn: async (input: ScheduleWorkOrderRequest) => {
      await api.post(`/workflows/schedule_work_order`, input);
    },
  });
}

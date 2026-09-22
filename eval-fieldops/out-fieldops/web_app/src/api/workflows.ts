// Auto-generated.  Do not edit by hand.
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { api } from "./client";
import { moneySchema } from "../lib/schemas";

export const ScheduleWorkOrderRequest = z.object({
  workOrder: z.string().uuid(),
  technician: z.string().uuid(),
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

// Auto-generated.  Do not edit by hand.
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { api } from "./client";
import { moneySchema } from "../lib/schemas";

export const OpenByStatusRow = z.object({
  status: z.enum(["Draft", "Scheduled", "InProgress", "Completed", "Cancelled"]),
  howMany: z.number().int(),
});
export const OpenByStatusResponse = z.array(OpenByStatusRow);
export type OpenByStatusResponse = z.infer<typeof OpenByStatusResponse>;

export function useOpenByStatus() {
  return useQuery({
    queryKey: ["projections", "open_by_status"],
    queryFn: async () => {
      const r = await api.get(`/projections/open_by_status`);
      return OpenByStatusResponse.parse(r);
    },
  });
}

export const RevenueThisMonthResponse = z.object({
  revenue: moneySchema,
});
export type RevenueThisMonthResponse = z.infer<typeof RevenueThisMonthResponse>;

export function useRevenueThisMonth() {
  return useQuery({
    queryKey: ["projections", "revenue_this_month"],
    queryFn: async () => {
      const r = await api.get(`/projections/revenue_this_month`);
      return RevenueThisMonthResponse.parse(r);
    },
  });
}

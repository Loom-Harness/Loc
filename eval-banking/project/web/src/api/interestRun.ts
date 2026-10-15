// Auto-generated.  Do not edit by hand.
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, seg } from "./client";





export const InterestRunResponse = z.object({
  id: z.string(),
  startedAt: z.string(),
  version: z.number().int(),
});
export type InterestRunResponse = z.infer<typeof InterestRunResponse>;
export const InterestRunListResponse = z.array(InterestRunResponse);
export type InterestRunListResponse = z.infer<typeof InterestRunListResponse>;

export function useAllInterestRuns() {
  return useQuery({
    queryKey: ["interest_runs"],
    queryFn: async () => {
      const r = await api.get(`/interest_runs`);
      return InterestRunListResponse.parse(r);
    },
  });
}

export function useInterestRunById(id: string | undefined) {
  return useQuery({
    queryKey: ["interest_runs", id],
    enabled: !!id,
    queryFn: async () => {
      const r = await api.get(`/interest_runs/${seg(id)}`);
      return InterestRunResponse.parse(r);
    },
  });
}

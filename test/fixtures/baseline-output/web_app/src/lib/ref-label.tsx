// Auto-generated.  Do not edit by hand.
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { api, seg } from "../api/client";

/** Labels a cross-aggregate reference with the referenced record's
 *  `display`; renders `children` (the truncated id) until — or unless —
 *  there is one. */
export function LoomRefLabel({ path, id, children }: { path: string; id: string; children: ReactNode }) {
  const ref = useQuery({
    queryKey: ["loom-ref-label", path, id],
    enabled: !!id,
    queryFn: async () => (await api.get(`${path}${seg(id)}`)) as { display?: unknown } | null,
  });
  const label = ref.data?.display;
  return <>{typeof label === "string" && label !== "" ? label : children}</>;
}

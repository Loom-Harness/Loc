// `src/lib/ref-label.tsx` — the per-cell child that labels an `IdLink` with the
// referenced record's `display` (fleet slice B; the `renderRefLabelWrap` seam in
// `_walker/target.ts`).
//
// It is a COMPONENT, not a hook in the page, because an `IdLink` usually sits
// in a `Table` row loop: one `useXById` per row in the page body breaks the
// rules-of-hooks.  Inside a child the hook is legal, and TanStack Query dedupes
// the reads — N rows referencing one record cost ONE request.  The cache key is
// its own (`loom-ref-label`) rather than the by-id hook's, because this read
// keeps the raw JSON and the by-id hook caches the zod-PARSED record.
//
// The children are the pack's truncated-id label — rendered while loading, on
// error (a 404, a 403 under a read policy), and when the record has no
// non-empty `display`.  Emitted only when some page renders the child.

export const REACT_REF_LABEL_PATH = "src/lib/ref-label.tsx";

export const REF_LABEL_MARKER = "<LoomRefLabel";

export const REACT_REF_LABEL = `// Auto-generated.  Do not edit by hand.
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { api, seg } from "../api/client";

/** Labels a cross-aggregate reference with the referenced record's
 *  \`display\`; renders \`children\` (the truncated id) until — or unless —
 *  there is one. */
export function LoomRefLabel({ path, id, children }: { path: string; id: string; children: ReactNode }) {
  const ref = useQuery({
    queryKey: ["loom-ref-label", path, id],
    enabled: !!id,
    queryFn: async () => (await api.get(\`\${path}\${seg(id)}\`)) as { display?: unknown } | null,
  });
  const label = ref.data?.display;
  return <>{typeof label === "string" && label !== "" ? label : children}</>;
}
`;

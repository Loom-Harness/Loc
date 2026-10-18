// `src/lib/components/LoomRefLabel.svelte` — the Svelte twin of the React
// per-cell reference label (`react/ref-label-runtime.ts` carries the
// rationale).  The `children` snippet is the fallback: the pack's truncated-id
// label renders while loading, on error, and when the record has no non-empty
// `display`.

export const SVELTE_REF_LABEL_PATH = "src/lib/components/LoomRefLabel.svelte";

export const SVELTE_REF_LABEL = `<script lang="ts">
  // Auto-generated.  Do not edit by hand.
  import type { Snippet } from "svelte";
  import { createQuery } from "@tanstack/svelte-query";
  import { api, seg } from "$lib/api/client";

  const { path, id, children }: { path: string; id: string; children: Snippet } = $props();
  const ref = createQuery(() => ({
    queryKey: ["loom-ref-label", path, id],
    enabled: !!id,
    queryFn: async () => (await api.get(\`\${path}\${seg(id)}\`)) as { display?: unknown } | null,
  }));
  const label = $derived.by(() => {
    const d = ref.data?.display;
    return typeof d === "string" && d !== "" ? d : undefined;
  });
</script>

{#if label}{label}{:else}{@render children()}{/if}
`;

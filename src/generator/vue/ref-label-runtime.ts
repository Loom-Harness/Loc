// `src/components/LoomRefLabel.vue` — the Vue twin of the React per-cell
// reference label (`react/ref-label-runtime.ts` carries the rationale).  An SFC
// because the slot is the fallback: the pack's truncated-id label renders while
// loading, on error, and when the record has no non-empty `display`.

export const VUE_REF_LABEL_PATH = "src/components/LoomRefLabel.vue";

export const VUE_REF_LABEL = `<script setup lang="ts">
// Auto-generated.  Do not edit by hand.
import { useQuery } from "@tanstack/vue-query";
import { computed } from "vue";
import { api, seg } from "../api/client";

const props = defineProps<{ path: string; id: string }>();
const ref = useQuery({
  queryKey: computed(() => ["loom-ref-label", props.path, props.id]),
  enabled: computed(() => !!props.id),
  queryFn: async () => (await api.get(\`\${props.path}\${seg(props.id)}\`)) as { display?: unknown } | null,
});
const label = computed(() => {
  const d = ref.data.value?.display;
  return typeof d === "string" && d !== "" ? d : undefined;
});
</script>

<template><template v-if="label">{{ label }}</template><slot v-else /></template>
`;

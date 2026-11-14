# D-VUE-FRONTEND — reuse the shared walker, Vite+vue-router SPA, vee-validate forms

`platform: vue` (Phase B of the platform-expansion roadmap;
[`docs/old/plans/vue-frontend-plan.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/plans/vue-frontend-plan.md)) ships as the third frontend with
three locked choices:

1. **Reuse, not fork.**  Vue pages render through the SHARED markup
   walker (`src/generator/_walker/`) with `vueTarget` supplying the
   leaf seams.  Where Vue genuinely diverges from the JSX family the
   CONTRACT grew (renderInterpolation / renderAttrBinding /
   renderMatchChild) rather than the walker forking — every extension
   byte-identical for TSX/HEEx.  The api/workflows module
   builders moved to `src/generator/_frontend/` and are shared
   verbatim (TanStack Query's call surface is identical across
   react-query and vue-query; one import-specifier knob).
2. **Plain Vite SPA + vue-router** — `createWebHistory`, explicit
   route table in `src/router.ts`, `<script setup lang="ts">` SFC
   pages, the same two-stage vite-build/vite-preview docker runtime
   as React.  No Nuxt.
3. **vee-validate forms** (`src/lib/form.ts` — `useLoomForm`): the Vue
   analog of the React packs' react-hook-form.  `useForm` drives
   validation + submit over the SAME shared zod request schema, adapted
   by a locally-emitted `toTypedSchema` (`@vee-validate/zod` is NOT a
   dep — its peer pins zod 3 while the stack is zod 4, so a plain
   `npm install` would ERESOLVE; vee-validate core carries no zod
   peer).  `values` stays a local `reactive()` draft (so pack markup's
   `v-model` + array push/splice keep working) and is pushed into
   vee-validate on submit; per-field error map + ProblemDetails-style
   server-error application preserved.  The `useLoomForm` seam keeps
   the same surface, so pack markup + testids are unchanged across
   packs.

Packs: `vuetify@v3` (npm-package model, the default) and
`shadcnVue@v1` (source-copy: reka-ui + Tailwind 4 + a components-ui
barrel; pack-declared `imports` tables flow into page scripts).  Vue
packs own the `op-dialog` operation-modal wrapper.  `vue` is a
STATIC_BUNDLE_FRAMEWORK — dotnet/java/phoenix hosts embed a
`framework: vue` ui exactly like a React one.

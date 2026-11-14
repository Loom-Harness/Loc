# D-SVELTE-FRONTEND — Svelte reuses the shared markup walker; SvelteKit static SPA; runes-native data/forms

**Decision.**  The Svelte frontend (`platform: svelte`) is NOT a fork of the
React generator.  Pages flow through the SAME shared markup walker
(`src/generator/_walker/walker-core.ts`) with a `svelteTarget`
(`WalkerTarget` impl) and svelte-format design packs (`shadcnSvelte`,
`flowbite`) supplying the framework surface.  Three sub-decisions:

1. **App shape: SvelteKit static SPA** (`@sveltejs/adapter-static`,
   `ssr = false`, fallback `index.html`), served with `vite preview` exactly
   like the React SPA.  File-based routing maps the page metamodel's routes
   (`/orders/:id` → `src/routes/(app)/orders/[id]/+page.svelte`); route
   groups `(app)` / `(bare)` carry the layout selectors.  Chosen over a
   Vite + community-router SPA because SvelteKit is the ecosystem's
   maintained routing answer — dependency risk kills generated-code
   products faster than structural asymmetry.
2. **Data layer: `@tanstack/svelte-query` v6** — runes-native
   `createQuery(() => opts)` returns a reactive object with the
   React-Query property surface (`.data` / `.isPending` / `.mutate`), so
   the generated api factories keep the TSX hook NAMES
   (`useAllCustomers`, `useCreateCustomer`, …) and the walker's api seam
   is name-compatible across both frontends.  The zod schema half of
   every api module is emitted byte-identically from the shared
   `src/generator/_frontend/zod-schemas.ts`.
3. **Forms: hand-rolled runes + zod** (`$lib/forms.svelte.ts` —
   `createForm` with `values` / `errors` / `submit` / `applyServerErrors`),
   no third-party form dependency.  Field templates bind
   `form.values.<path>`; RFC 7807 422s decode onto the same per-field
   error map react gets from apply-server-errors.  Operation-form modals
   render as page-scope `{#snippet <op>OpModal(form)}` blocks (one
   component per .svelte file — module scope lands in the template).

**Walker contract.**  The Svelte port added five `WalkerTarget` seams:
the four markup seams (`renderComment`, `renderConditionalChild`,
`renderStyleAttr`, `escapeText`) plus `renderChildrenSlot` and
`formRuntimeImports`.  Svelte 5 shares JSX's `{expr}` interpolation,
`<Comp x={y}/>` invocation and `data-testid={expr}` syntax — those stay
hardcoded in the shared walker; the seams cover exactly where the two
markups diverge.

**Hosting.**  `svelte` joined `STATIC_BUNDLE_FRAMEWORKS`: dotnet
fullstack hosts embed SvelteKit SPAs under `ClientApp/` (the Dockerfile
copies the adapter-static `build/` into wwwroot).  Phoenix is the
deliberate exception — it serves embedded SPAs under the `/app` path
prefix, which a SvelteKit bundle needs `paths.base` threading for; its
surface excludes `svelte` until that lands.  The in-browser playground
preview is likewise deferred (Svelte compiler in the VFS bundler).

See [`docs/old/plans/svelte-frontend-plan.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/plans/svelte-frontend-plan.md) for the slice history.

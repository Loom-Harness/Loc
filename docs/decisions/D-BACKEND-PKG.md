# D-BACKEND-PKG — per-version backend packages are canonical

**Status:** PINNED.

**Problem.** Two layout docs disagree about where framework-coupled
backend code lives. `platform-directory-layout.md` recommends
**Option A** — reverse the `src/platform/hono/v4/` hoist back down
into `src/generator/<platform>/frameworks/…`, shrinking `src/platform/`
to thin surface records. Separately, [`docs/old/plans/packaging-split.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/plans/packaging-split.md)
(P0–P4, partly shipped) drives toward the opposite: each backend
becomes a **separately-installable per-version npm package**
(`@loom/backend-hono-v4`, `@loom/backend-dotnet-v8`, `-v10`, …)
discovered via its `loom` package.json key, so old + new majors coexist
and `@loom/core` never statically bundles a backend.
`src/platform/hono/v4/` is the staging shape for that relocation
(P3-slice-5), currently blocked only on browser-side backend discovery.

**Decision.** The packaging-split end-state is **canonical**. Backends
are per-version packages; `@loom/core` keeps the framework-neutral emit
(`render-expr`/`render-stmt`, DTO/VO/id/event templates) + the
`PlatformSurface` contract + the resolver. The `package → shared`
layering invariant — *shared code under `src/generator/` must never
import from `src/platform/<family>/<vN>/`*, guarded by
`test/platform/backend-packages-layering.test.ts` — is load-bearing.

`platform-directory-layout.md` **Option A is rejected**: it would
re-pin shared core to one framework version (blocking `hono@v5`) and is
forbidden by the live invariant. The *direction* that survives is
per-`<family>/v<N>/` homes that map 1:1 to packages; the existing hono
hoist is correct, not to be reversed.

**Note (2026-10).** `node@v4` was retired (see #3687): `packages/backend-hono-v4/`
and its pins are gone, `node@v5` is the only registered Hono version, and a
`node@v4` pin fails with `loom.platform-version-unknown` naming `node@v5`
(`RETIRED_BACKEND_VERSIONS` in `src/platform/metadata.ts`).
`src/platform/hono/v4/` remains only as the shared Hono emitter +
`makeHonoPlatform` factory that v5 calls.

**Mechanism / sequencing.**

- No speculative scaffolding — no `v5/`, `express/`, `nestjs/`, adapter
  sub-version dirs, or publish wrappers until a real consumer exists.
- The dotnet (then phoenix) core↔backend split — mirroring hono's P2 —
  is sanctioned now that F6d proved the boundary, but is sequenced
  **after** the storage F-series' remaining persistence-dispatch slices
  land (they still edit `src/generator/dotnet` / `phoenix-live-view`).
- Physical relocation into `packages/` (P3-slice-5) stays gated on
  browser-side backend discovery; until then the in-`src` staging dirs
  + thin re-export wrappers are the reachable shape.

**Affects.**

- `platform-directory-layout.md` — the "Recommendation" section and the
  V1 row (recommending Option A) are superseded; the doc carries a
  "Pinned decisions affecting this proposal" banner pointing here.
- `per-package-output-tree.md` — the *output-side* twin of this decision
  (per-layer output packages). Right direction, **deferred** on one-time
  cost + playground-workspace prerequisite, not rejected; expressible as
  a `LayoutAdapter` extension.
- [`docs/old/plans/packaging-split.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/plans/packaging-split.md) / `backend-packages.md` — promoted
  from "plan" to the pinned target for backend layout.

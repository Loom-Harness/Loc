# D-HONO-SHARED — the Hono emitter lives in a version-free `shared/` dir; the versioned-package machinery stays with one consumer

**Status:** PINNED (#4843).

**Context.** `node@v4` is retired, yet the whole Hono backend sat in
`src/platform/hono/v4/` while the one registered version, `v5/`, was a pin
set calling into it. A reader looking for the live backend landed in a
directory named after a version that no longer exists. With `v4/` gone, the
backend-package machinery (`LoomBackendManifest` in `manifest.ts`,
`fs-discovery.ts`, `packages/backend-hono-v5`) has exactly one consumer.

**Decision.**
- The emitter and the `makeHonoPlatform` surface factory live in
  `src/platform/hono/shared/`. A directory under `hono/` carries a version
  name only while that version is registered; today that is `v5/`, a pin
  set (`pins.ts`) fed through the shared factory.
- The versioned-package machinery stays. It is the seam the open-core
  release plan (#3315) builds on — backends as loadable packages with a
  manifest, discovered rather than statically registered — and a second
  `node` version (a future `v6/` pin set over `shared/`) reuses it unchanged.
  Removing it now to re-add it for #3315 would cost more than keeping one
  consumer.

**Consequences.** Adding a `node` version is a new `hono/v<N>/` pin set plus a
registry row (`docs/platforms.md` § Backend versioning); `shared/` is never
renamed for it. Retiring a version deletes its pin-set directory only.

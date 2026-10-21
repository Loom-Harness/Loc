// ---------------------------------------------------------------------------
// hono@v5 — dependency pins (the version-owned "templating" slice of
// the backend package; the shared emitter under `../v4/` reads them).
//
// The package version tracks its dep majors, not Hono's: Hono itself is
// 4.x, and v5 is the zod 4 (+ `@hono/zod-openapi` 1.x) / TypeScript 6 set.
// TypeScript stays on `^6` — TS 7 (the native compiler port) is its own
// major step, not a routine bump.  The generated image runs `node:24`.
//
// This file + the thin `index.ts` surface ARE the whole package; it is
// the only registered `node` version.  `LOOM_TS_BUILD` (`tsc --noEmit` +
// tsup against an emitted Hono project) proves these resolve and
// typecheck together, and the behavioral boot gate that they boot.
// ---------------------------------------------------------------------------
export const BACKEND_PINS = {
  dependencies: {
    hono: "^4.12.0",
    "@hono/node-server": "^2.0.0",
    // `1.5.2` shipped a `.openapi()` declaration-merging regression: chaining
    // `.refine(...)` after `.openapi("Name")` (routes-builder.ts's
    // `emitWireSchema`) loses the callback's contextual param type — a
    // `strict`/`noImplicitAny` TS7006 on every corpus feature with a
    // cross-field invariant, confirmed via `npm view` bisection (1.5.1 clean,
    // 1.5.2 broken, both against zod 4.4.3) and reproducing with ZERO Loom
    // code touched (a hand-written `z.string().transform((s, ctx) => …)`
    // template broke too, on the 1.5.2+zod-4.4.3 pairing specifically).  Not
    // this repo's bug — an upstream type regression on a floating `^1.0.0`
    // range.  Re-verify (bisect the same way) before widening this back to a
    // plain caret; a later patch may fix it forward.
    "@hono/zod-openapi": "^1.0.0 <1.5.2 || >1.5.2 <2.0.0",
    zod: "^4.0.0",
    "drizzle-orm": "^0.45.0",
    pg: "^8.13.0",
    pino: "^10.3.0",
    "prom-client": "^15.1.0",
    // OpenTelemetry tracing (M-T7.1): the request seam opens a SERVER span
    // per request; exported via OTLP/HTTP only when a collector endpoint is
    // set (obs/tracing.ts).  The `-otlp-http` exporter posts JSON via fetch,
    // so it bundles for the browser playground too.
    "@opentelemetry/api": "^1.9.0",
    "@opentelemetry/sdk-trace-base": "^2.1.0",
    "@opentelemetry/exporter-trace-otlp-http": "^0.205.0",
    "@opentelemetry/resources": "^2.1.0",
    "@opentelemetry/semantic-conventions": "^1.37.0",
    uuidv7: "^1.0.2",
  },
  devDependencies: {
    typescript: "^6.0.0",
    tsx: "^4.19.0",
    tsup: "^8.3.0",
    // vitest is held at 3.x, NOT 4.x, until npm's resolver can install
    // vitest 4's peer graph again.  `npm install vitest@4` currently dies in
    // arborist's `#loadPeerSet` (`Cannot read properties of null (reading
    // 'edgesOut')`, npm 10.9.7) while walking `@vitest/browser-playwright@5`
    // — reproducible in an empty directory with `npm init -y && npm install
    // vitest@4`, so it is upstream, not ours.  A generated project ships no
    // lockfile (see the Dockerfile comment on `npm install` vs `npm ci`), so
    // every `docker compose up` and every corpus/behavioural leg resolves the
    // graph fresh and hits it.  3.x resolves cleanly and runs the emitted
    // `describe`/`it`/`expect` tests unchanged.  Restore `^4.0.0` once a
    // vitest 4 release installs under a stock npm.
    vitest: "^3.2.0",
    "drizzle-kit": "^0.31.0",
    "@types/pg": "^8.11.0",
    "pino-pretty": "^13.0.0",
  },
} as const;

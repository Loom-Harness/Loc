// ---------------------------------------------------------------------------
// hono@v5 — dependency pins (the version-owned "templating" slice of
// the backend package; the shared emitter under `../v4/` reads them).
//
// The package version tracks its dep majors, not Hono's: Hono itself is
// 4.x, and v5 is the zod 4 (+ `@hono/zod-openapi` 1.x) / TypeScript 6 set.
// TypeScript stays on 6.x — TS 7 (the native compiler port) is its own
// major step, not a routine bump.  The generated image runs `node:24`.
//
// This file + the thin `index.ts` surface ARE the whole package; it is
// the only registered `node` version.  `LOOM_TS_BUILD` (`tsc --noEmit` +
// tsup against an emitted Hono project) proves these resolve and
// typecheck together, and the behavioral boot gate that they boot.
// ---------------------------------------------------------------------------
export const BACKEND_PINS = {
  dependencies: {
    hono: "4.13.14",
    "@hono/node-server": "2.1.5",
    // `1.5.2` shipped a `.openapi()` declaration-merging regression: chaining
    // `.refine(...)` after `.openapi("Name")` (routes-builder.ts's
    // `emitWireSchema`) loses the callback's contextual param type in
    // @hono/zod-openapi 1.5.2 (zod 4.4.3) — a `strict`/`noImplicitAny` TS7006 on
    // every corpus feature with a cross-field invariant.  1.5.1 and 1.6.x are
    // clean; this exact pin sits on a clean release, so re-bisect before
    // moving it.
    "@hono/zod-openapi": "1.6.3",
    zod: "4.6.7",
    "drizzle-orm": "0.45.4",
    pg: "8.23.1",
    pino: "10.4.0",
    "prom-client": "15.1.3",
    // OpenTelemetry tracing (M-T7.1): the request seam opens a SERVER span
    // per request; exported via OTLP/HTTP only when a collector endpoint is
    // set (obs/tracing.ts).  The `-otlp-http` exporter posts JSON via fetch,
    // so it bundles for the browser playground too.
    "@opentelemetry/api": "1.9.1",
    "@opentelemetry/sdk-trace-base": "2.12.0",
    "@opentelemetry/exporter-trace-otlp-http": "0.205.0",
    "@opentelemetry/resources": "2.12.0",
    "@opentelemetry/semantic-conventions": "1.43.0",
    uuidv7: "1.2.1",
  },
  devDependencies: {
    typescript: "6.0.3",
    tsx: "4.23.15",
    tsup: "8.5.1",
    // vitest is held at 3.x, NOT 4.x, until npm's resolver can install
    // vitest 4's peer graph again.  `npm install vitest@4` currently dies in
    // arborist's `#loadPeerSet` (`Cannot read properties of null (reading
    // 'edgesOut')`, npm 10.9.7) while walking `@vitest/browser-playwright@5`
    // — reproducible in an empty directory with `npm init -y && npm install
    // vitest@4`, so it is upstream, not ours.  A generated project ships no
    // lockfile (see the Dockerfile comment on `npm install` vs `npm ci`), so
    // every `docker compose up` and every corpus/behavioural leg resolves the
    // graph fresh and hits it.  3.x resolves cleanly and runs the emitted
    // `describe`/`it`/`expect` tests unchanged.  Move to vitest 4+ once a
    // release installs under a stock npm.
    vitest: "3.2.7",
    "drizzle-kit": "0.31.11",
    "@types/pg": "8.23.1",
    "pino-pretty": "13.2.0",
  },
} as const;

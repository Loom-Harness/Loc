// `config: { spec }` on a restApi storage → the OpenAPI document the playground
// mock samples from: resolved in `migrationPlan`, carried in the boot plan,
// registered with the `httpMock` service.  The bundle-and-boot leg is
// `web/e2e/resource-fakes.spec.ts`.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("openapi-sampler", () => ({
  sample: (schema: { properties?: Record<string, { type: string }> }) =>
    Object.fromEntries(
      Object.entries(schema.properties ?? {}).map(([k, v]) => [k, v.type === "number" ? 0 : ""]),
    ),
}));

import { bootPlan } from "../../web/src/build/boot-plan.js";
import { migrationPlan } from "../../web/src/build/evolution.js";
import type { MigrationPlanOk } from "../../web/src/build/protocol.js";
import { restSpecsOf } from "../../web/src/build/rest-specs.js";
import { httpMockService } from "../../web/src/runtime/infra/http-mock.js";

const ENTRY = "/workspace/main.ddd";
const example = readFileSync(
  path.resolve(__dirname, "../../web/src/examples/resource-fakes-system.ddd"),
  "utf8",
);

const storage = (config: Record<string, string>) => ({
  name: "fx",
  type: "restApi",
  config: Object.entries(config).map(([key, value]) => ({ key, value: { kind: "string", value } })),
});
const SPEC = '{"openapi":"3.0.0","paths":{}}';

describe("restSpecsOf", () => {
  it("reads an inline spec, or a file beside the entry", () => {
    const files: Record<string, string> = { "/workspace/specs/fx.json": SPEC };
    const read = (p: string) => files[p];
    expect(
      restSpecsOf([storage({ baseUrl: "https://fx.test/v1", spec: SPEC })], read, "/workspace")
        .specs,
    ).toEqual([{ origin: "https://fx.test", spec: { openapi: "3.0.0", paths: {} } }]);
    expect(
      restSpecsOf(
        [storage({ baseUrl: "https://fx.test", spec: "specs/fx.json" })],
        read,
        "/workspace",
      ).specs,
    ).toHaveLength(1);
  });

  it("warns, and answers with an echo, when the spec cannot be used", () => {
    const missing = restSpecsOf(
      [storage({ baseUrl: "https://fx.test", spec: "nope.json" })],
      () => undefined,
      "/workspace",
    );
    expect(missing.specs).toEqual([]);
    expect(missing.diagnostics[0]).toMatchObject({ severity: "warning" });
    expect(
      restSpecsOf([storage({ baseUrl: "https://fx.test", spec: "{oops" })], () => undefined, "/w")
        .diagnostics,
    ).toHaveLength(1);
    expect(restSpecsOf([storage({ baseUrl: "https://fx.test" })], () => undefined, "/w")).toEqual({
      specs: [],
      diagnostics: [],
    });
  });
});

describe("the resource-fakes example's rates mock", () => {
  it("samples the declared spec instead of echoing", async () => {
    const r = (await migrationPlan({
      current: { entryPath: ENTRY, files: [{ kind: "file", path: ENTRY, content: example }] },
    })) as MigrationPlanOk;
    expect(r.ok).toBe(true);
    expect(r.restSpecs.map((s) => s.origin)).toEqual(["https://fx.example.test"]);
    const plan = bootPlan(
      [],
      { kind: "unversioned" },
      [],
      () => ({ dataDir: ":memory:", island: null }),
      undefined,
      r.restSpecs,
    );
    expect(plan.plan.restSpecs).toHaveLength(1);

    for (const s of plan.plan.restSpecs ?? [])
      await httpMockService.handle({ op: "registerSpec", params: s }, { client: null });
    const res = (await httpMockService.handle(
      { op: "request", params: { method: "GET", url: "https://fx.example.test/rate/usd" } },
      { client: null },
    )) as { status: number; body: Record<string, unknown> };
    expect(res.body).toEqual({ rate: expect.any(Number), ccy: expect.any(String) });
    expect(res.body).not.toHaveProperty("mock");
  });
});

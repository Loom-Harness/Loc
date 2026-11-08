// The OpenAPI half of an expected-failure entry point (`T or E` on a workflow
// `create` / routed handler): every backend that renders it publishes the
// split an operation's union publishes (`opUnionResponses`) — 200 →
// `<Union>Success` over the success arms, each error arm's status →
// ProblemDetails or `<Tag>Problem` — on the workflow's command route and on
// the routed handler's path.  Each backend's emitted registration is read in
// its own dialect; the shape it names is the same on all four.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const SOURCE = (platform: string) =>
  readFileSync("test/fixtures/corpus/workflow-expected-failure.ddd", "utf8").replace(
    "__PLATFORM__",
    platform,
  );

const all = async (platform: string): Promise<string> =>
  [...(await generateSystemFiles(SOURCE(platform))).values()].join("\n");

/** The split each entry route publishes: its success component and the
 *  problem component at 409. */
const ROUTES = [
  {
    node: '"/pay"',
    path: "/api/workflows/pay",
    id: "payWorkflow",
    success: "ReceiptOrPaymentDeclinedSuccess",
  },
  {
    node: '"/hold"',
    path: "/api/workflows/hold",
    id: "holdWorkflow",
    success: "HoldOrPaymentDeclinedSuccess",
  },
  {
    node: '"/charge/{account}"',
    path: "/api/charge/{account}",
    id: "charge",
    success: "AccountOrPaymentDeclinedSuccess",
  },
  {
    node: '"/peek/{account}"',
    path: "/api/peek/{account}",
    id: "peek",
    success: "intOrPaymentDeclinedSuccess",
  },
] as const;

describe("expected-failure entry routes publish the operation union split", () => {
  it("node", async () => {
    const src = await all("node");
    expect(src).toContain('.openapi("PaymentDeclinedProblem")');
    for (const r of ROUTES) {
      expect(src).toContain(`.openapi("${r.success}")`);
      const at = src.indexOf(`path: ${r.node}`);
      const block = src.slice(at, src.indexOf("async (httpCtx)", at));
      expect(block).toContain(`schema: ${r.success}`);
      expect(block).toContain(
        '409: { description: "Conflict", content: { "application/problem+json": { schema: z.union([ProblemDetails, PaymentDeclinedProblem]) } } }',
      );
    }
  });

  it(".NET", async () => {
    const src = await all("dotnet");
    expect(src).toContain('schemas["PaymentDeclinedProblem"]');
    for (const r of ROUTES) {
      expect(src).toContain(`schemas["${r.success}"]`);
      const at = src.indexOf(`case "${r.id}":`);
      expect(at).toBeGreaterThan(0);
      expect(src.slice(at, src.indexOf("break;", at))).toContain(
        `RetargetSuccess(operation, swaggerDoc, "${r.success}")`,
      );
      expect(src.slice(at, src.indexOf("break;", at))).toContain(
        'RetargetProblem(operation, "409"',
      );
    }
  });

  it("Java", async () => {
    const src = await all("java");
    expect(src).toContain('"PaymentDeclinedProblem"');
    for (const r of ROUTES) expect(src).toContain(`"${r.success}"`);
    for (const r of ROUTES) expect(src).toContain(`"${r.path}"`);
  });

  it("Python", async () => {
    const src = await all("python");
    for (const r of ROUTES) expect(src).toContain(`"${r.path}":"${r.success}"`);
    expect(src).toContain('"PaymentDeclinedProblem"');
    expect(src).toContain('_OP_UNION_METHODS: dict[str, str] = {"/api/peek/{account}":"get"}');
  });
});

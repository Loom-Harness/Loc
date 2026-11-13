// The OpenAPI half of an expected-failure entry point (`T or E` on a workflow
// `create` / routed handler): every backend that renders it publishes the
// split an operation's union publishes (`opUnionResponses`) — 200 →
// `<Union>Success` over the success arms, each error arm's status →
// ProblemDetails or `<Tag>Problem` (.NET: the open ProblemDetails, see below)
// — on the workflow's command route and on the routed handler's path.  Each backend's emitted registration is read in
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

  // .NET publishes through Swashbuckle's own generator (D-OPENAPI-FRAMEWORK-NATIVE):
  // the 200 names the `<Union>Success` record, which declares only the success
  // arms as its `[JsonDerivedType]`s, and the 409 declares the open
  // ProblemDetails body — Swashbuckle composes no `anyOf`, and the open body
  // accepts exactly what `ProblemDetails | <Tag>Problem` accepts.
  it(".NET", async () => {
    const src = await all("dotnet");
    for (const r of ROUTES) {
      const decl = src.indexOf(`public abstract record ${r.success} :`);
      expect(decl, r.success).toBeGreaterThan(0);
      const attrs = src.slice(src.lastIndexOf("[JsonPolymorphic", decl), decl);
      expect(attrs).not.toContain("_PaymentDeclined)");
      expect(src).toMatch(new RegExp(`\\.${r.success}\\), 200\\)\\]`));
    }
    expect(src).toContain(
      '[ProducesResponseType(typeof(ProblemResponse), 409, "application/problem+json")]',
    );
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

import { describe, expect, it } from "vitest";
import { validate } from "../../src/api/index.js";

// `loom.test-statement-invalid` — the statement vocabulary of the test tiers
// `loom.aggregate-test-context` never covered. Before it, every refused model
// below was `0 error(s)` at parse and crashed `generate` on every backend
// ("unsupported integration-test statement 'precondition'" /
// "aggregate test body contains 'emit'").

const wrap = (inner: string): string => `
system S {
  subdomain P {
    context T {
      event Pinged { n: int }
      valueobject Qty {
        n: int
        invariant n >= 0
${inner.includes("@vo") ? inner.replace("@vo", "") : ""}
      }
      aggregate Task with crudish { title: string }
      repository Tasks for Task { }
${inner.includes("@ctx") ? inner.replace("@ctx", "") : ""}
    }
  }
  api TA from P
  storage primary { type: postgres }
  resource st { for: T, kind: state, use: primary }
  deployable api { platform: node contexts: [T] dataSources: [st] serves: TA port: 4000 }
}
`;

async function errorCodes(src: string): Promise<string[]> {
  const r = await validate(src);
  return r.diagnostics.filter((d) => d.severity === "error").map((d) => d.code ?? "");
}

describe("loom.test-statement-invalid", () => {
  it("refuses a precondition in a context integration test", async () => {
    expect(await errorCodes(wrap(`@ctx test "t" { precondition 1 > 0 }`))).toEqual([
      "loom.test-statement-invalid",
    ]);
  });

  it("refuses an emit in a context integration test", async () => {
    expect(await errorCodes(wrap(`@ctx test "t" { emit Pinged { n: 1 } }`))).toEqual([
      "loom.test-statement-invalid",
    ]);
  });

  it("refuses an emit in a value-object unit test", async () => {
    expect(await errorCodes(wrap(`@vo test "t" { emit Pinged { n: 1 } }`))).toEqual([
      "loom.test-statement-invalid",
    ]);
  });

  it("accepts the vocabulary both tiers render", async () => {
    expect(
      await errorCodes(
        wrap(`@ctx test "t" {
          let q = Qty { n: 1 }
          expect(q.n).toBe(1)
        }`),
      ),
    ).toEqual([]);
    expect(
      await errorCodes(
        wrap(`@vo test "v" {
          let q = Qty { n: 2 }
          expect(q.n).toBe(2)
        }`),
      ),
    ).toEqual([]);
  });
});

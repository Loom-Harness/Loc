import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validate } from "../../src/api/index.js";
import { REPO_ROOT } from "../_helpers/ddd-corpus.js";

// `loom.member-unresolved` — the IR backstop for an invented member the
// language layer never typed (`src/ir/validate/checks/member-resolution-checks.ts`).
//
// Before it, every model below was `0 error(s), 0 warning(s)` and node emitted
// `(…)[0].nope` into domain/task.ts. The receivers are typed `unknown` by the
// language layer (a `let` bound from a list literal / a collection-op result),
// so the AST member check stood down.

const wrap = (ops: string): string => `
system Tasks {
  subdomain P {
    context T {
      valueobject Addr { street: string }
      aggregate Task with crudish {
        title: string
        addr: Addr
        addrs: Addr[]
${ops}
      }
      repository Tasks for Task { }
    }
  }
  api TA from P
  storage primary { type: postgres }
  resource st { for: T, kind: state, use: primary }
  deployable api { platform: node contexts: [T] dataSources: [st] serves: TA port: 4000 }
}
`;

async function codes(src: string): Promise<{ code?: string; message: string }[]> {
  const r = await validate(src);
  return r.diagnostics.filter((d) => d.severity === "error");
}

describe("loom.member-unresolved", () => {
  it("refuses an invented member on a let-bound list element", async () => {
    const errs = await codes(
      wrap(`
        operation probe() {
          let xs = [this.addr]
          title := xs.first().nope
        }`),
    );
    expect(errs.map((e) => e.code)).toEqual(["loom.member-unresolved"]);
    expect(errs[0]?.message).toContain("'nope' is not a member of 'Addr'");
    expect(errs[0]?.message).toContain("street");
  });

  it("refuses an invented member read through a second let", async () => {
    const errs = await codes(
      wrap(`
        operation probe() {
          let xs = [this.addr, this.addr]
          let a = xs.first()
          title := a.nope
        }`),
    );
    expect(errs.map((e) => e.code)).toEqual(["loom.member-unresolved"]);
  });

  it("accepts the declared member through the same receivers", async () => {
    const errs = await codes(
      wrap(`
        operation probe() {
          let xs = [this.addr]
          title := xs.first().street
        }
        operation probe2() {
          let m = this.addrs.map(x => x)
          title := m.first().street
        }`),
    );
    expect(errs).toEqual([]);
  });

  it("does not double-report what the AST validator already refuses", async () => {
    // `this.addr.nope` types fine in the language layer, so the AST check
    // owns it. The IR backstop fires too, which is fine, but the AST message
    // must still be there.
    const errs = await codes(
      wrap(`
        derived d: string = this.addr.nope`),
    );
    expect(
      errs.map((e) => e.message).some((m) => m.includes("'nope' is not a member of 'Addr'")),
    ).toBe(true);
  });

  it("refuses F-041: the error-quality corpus's typo'd page-body field (b09)", async () => {
    // `data: o => … o.totl` in a QueryView over `Order`: AST-clean (the lambda
    // param is untyped in the language layer), refused here.
    const src = readFileSync(`${REPO_ROOT}/eval/repro/broken/b09-page-wrong-aggregate.ddd`, "utf8");
    const errs = await codes(src);
    expect(errs.map((e) => e.code)).toContain("loom.member-unresolved");
    expect(errs.find((e) => e.code === "loom.member-unresolved")?.message).toContain("'totl'");
  });
});

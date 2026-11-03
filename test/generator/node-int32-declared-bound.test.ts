// A declared one-sided numeric bound (`precondition n > 0`, `invariant stock >= 0`)
// replaces only the int32 side it states.  Dropping the whole structural pair
// left `n` with `.min(1)` and no ceiling, so `2147483648` reached the driver
// as a 500 instead of the RS-42 422.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "./../_helpers/generate.js";

const RANGE = JSON.stringify("Integer out of range");

const src = `
system S {
  subdomain D {
    context C {
      aggregate Product with crudish {
        stock: int
        capped: int
        invariant stock >= 0
        invariant capped <= 10
        invariant stock + capped > -1000
        operation restock(n: int) {
          precondition n > 0
          stock := stock + n
        }
        operation cap(m: int) {
          precondition m >= 1 && m <= 5
          capped := m
        }
      }
      repository Products for Product
    }
  }
  api A from D
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable d { platform: node, contexts: [C], dataSources: [st], serves: A, port: 4000 }
}
`;

describe("node — a one-sided declared bound keeps the other int32 side", () => {
  it("min-only keeps the ceiling, max-only keeps the floor, two-sided drops both", async () => {
    const files = await generateSystemFiles(src);
    const key = [...files.keys()].find((k) => k.endsWith("http/product.routes.ts"));
    const routes = files.get(key as string) as string;
    const line = (re: RegExp): string => {
      const l = routes.split("\n").find((x) => re.test(x));
      expect(l, String(re)).toBeDefined();
      return l as string;
    };
    expect(line(/^\s*n: z\.number/)).toContain(`.max(2147483647, ${RANGE})`);
    expect(line(/^\s*n: z\.number/)).toContain(".min(1");
    expect(line(/^\s*n: z\.number/)).not.toContain(`.min(-2147483648`);
    expect(line(/^\s*m: z\.number/)).not.toContain("2147483647");
    expect(line(/^\s*m: z\.number/)).not.toContain("-2147483648");
    expect(line(/^\s*capped: z\.number/)).toContain(`.min(-2147483648, ${RANGE})`);
    expect(line(/^\s*capped: z\.number/)).not.toContain("2147483647");
  });
});

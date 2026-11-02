import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// Java expression-rendering fixes whose symptom was a `javac` error or a wrong
// runtime answer that every text-level gate stayed green on:
//  - an optional primitive (`bool?`/`int?`/`long?`) is a boxed `Boolean`/`Integer`/
//    `Long`; `==` on it is reference identity / an NPE-prone unboxing, so equality
//    goes through `Objects.equals` (with an `int` widened against a `long`).
//  - `decimal? ?? 0` renders a BigDecimal fallback, not a raw `0` ("bad type in
//    conditional expression").
//  - a variant `match` without `else` ends in a throwing `default`, which types
//    inside a primitive-yielding switch where `null` does not.
//  - `field := collection` takes a mutable copy so a later `field += v` appends.

const SRC = `
system S {
  subdomain Core {
    context Shop {
      error NotFound { resource: string }
      payload Hit { code: string }
      domainService Lookup {
        operation probe(code: string): Hit or NotFound {
          if (code.length > 0) {
            return Hit { code: code }
          }
          return NotFound { resource: code }
        }
      }
      aggregate Cond {
        flag: bool?
        n: int?
        l: long?
        d: decimal?
        upper: decimal?
        attributes: string[]
        score: int = 0
        derived sameFlag: bool = flag == true
        derived sameN: bool = n == 3
        derived sameL: bool = l == 3
        derived capped: decimal = upper ?? 0
        derived inRange: bool = (upper ?? 0) > 5.0
        create(attributes: string[]) {
          this.attributes := attributes
        }
        operation reset(v: string, w: string[]) {
          attributes := w
          attributes += v
        }
      }
      workflow claim {
        orderId: Cond id
        count: int
        create(orderId: Cond id, code: string) {
          let r = Lookup.probe(code)
          count := match r { Hit h => 1, NotFound n => 2 }
        }
      }
    }
  }
  api A from Core
  storage pg { type: postgres }
  resource shopState { for: Shop, kind: state, use: pg }
  deployable jsvc { platform: java  contexts: [Shop]  serves: A  dataSources: [shopState]  port: 8081 }
}
`;

const COND = "jsvc/src/main/java/com/loom/jsvc/features/conds/Cond.java";

async function file(path: string): Promise<string> {
  const text = (await generateSystemFiles(SRC)).get(path);
  expect(text, `${path} not emitted`).toBeDefined();
  return text as string;
}

describe("java — optional primitive equality", () => {
  it("compares bool? / int? / long? with Objects.equals, widening int against long", async () => {
    const cond = await file(COND);
    expect(cond).toContain("return Objects.equals(this.flag, true);");
    expect(cond).toContain("return Objects.equals(this.n, 3);");
    expect(cond).toContain("return Objects.equals(this.l, (long) (3));");
    expect(cond).not.toContain("this.flag == true");
  });
});

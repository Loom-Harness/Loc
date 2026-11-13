// ---------------------------------------------------------------------------
// Java backend — SCALAR (non-union) operation returns (BUG-003).
//
// An `operation describe(): string { return code }` must emit HTTP 200 with the
// returned value serialized to wire — NOT compute-then-discard as 204.  The
// aggregate method already returns the domain-typed value; the service converts
// it domain→wire and returns it (`String describe(...)` / money → `.toPlainString()`),
// and the controller wraps it in `ResponseEntity.ok(result)` under a CONCRETE
// `ResponseEntity<WireType>` (so springdoc infers the 200 body natively — no
// explicit `successRef` needed, unlike the union path's `ResponseEntity<?>`).
//
// Contrast with the union path (generator-java-operation-returns.test.ts): a
// scalar return is a union with ONE success variant and NO error variants, so it
// returns the RAW scalar wire value rather than a tagged union wrapper.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { validateLoomModel } from "../../../src/ir/validate/validate.js";
import { generateSystemFiles } from "../../_helpers/generate.js";
import { buildLoomModel } from "../../_helpers/ir.js";

const SRC = `system RU {
  subdomain D {
    context Shop {
      aggregate Order {
        code: string
        price: money
        operation describe(): string {
          return code
        }
        operation quote(): money {
          return price
        }
        operation taken(): bool {
          return true
        }
      }
      repository Orders for Order { }
    }
  }
  api A from D
  storage primary { type: postgres }
  resource st { for: Shop, kind: state, use: primary }
  deployable ruApi {
    platform: java
    contexts: [Shop]
    dataSources: [st]
    serves: A
    port: 8081
  }
}
`;

const ROOT = "ru_api/src/main/java/com/loom/ruapi";

async function files(): Promise<Map<string, string>> {
  return generateSystemFiles(SRC);
}

describe("java generator — scalar (non-union) operation returns (BUG-003)", () => {
  it("passes validation (scalar returns are a shipped feature, not gated)", async () => {
    const loom = await buildLoomModel(SRC);
    const errors = validateLoomModel(loom).filter((d) =>
      (d.code ?? "").startsWith("loom.operation-return"),
    );
    expect(errors).toEqual([]);
  });

  it("controller returns ResponseEntity<WireType> + ResponseEntity.ok(result), not void/204", async () => {
    const c = (await files()).get(`${ROOT}/features/orders/OrdersController.java`)!;
    // string scalar → wire String (concrete ResponseEntity type)
    expect(c).toContain("public ResponseEntity<String> describeOrder(@PathVariable UUID id");
    expect(c).toContain("var result = service.describe(new OrderId(id)");
    expect(c).toContain("return ResponseEntity.ok(result);");
    // money scalar → wire String too (precise-decimal string)
    expect(c).toContain("public ResponseEntity<String> quoteOrder(@PathVariable UUID id");
    expect(c).toContain("var result = service.quote(new OrderId(id)");
    // bool scalar → BOXED `Boolean` (a generic type argument can't be the
    // primitive `boolean` — `ResponseEntity<boolean>` doesn't compile)
    expect(c).toContain("public ResponseEntity<Boolean> takenOrder(@PathVariable UUID id");
    // the value is NOT discarded as a void 204
    expect(c).not.toContain("public void describeOrder");
    expect(c).not.toContain("public void quoteOrder");
    // no @ResponseStatus(NO_CONTENT) attached to a scalar op (only void ops keep it)
    expect(c).not.toMatch(/@ResponseStatus\(HttpStatus\.NO_CONTENT\)\s*\n\s*public ResponseEntity/);
  });

  it("service method is non-void and returns the domain→wire value", async () => {
    const svc = (await files()).get(`${ROOT}/features/orders/OrderService.java`)!;
    // string → returned raw (no conversion)
    expect(svc).toContain("public String describe(OrderId id");
    expect(svc).toContain("var result = aggregate.describe();");
    expect(svc).toContain("return result;");
    // money → domain BigDecimal serialized to its precise-decimal wire string
    expect(svc).toContain("public String quote(OrderId id");
    expect(svc).toContain("var result = aggregate.quote();");
    // Money scalar return → wire string at the FIXED NUMERIC(19,4) scale (RS-12).
    expect(svc).toContain(
      "return result.setScale(4, java.math.RoundingMode.HALF_UP).toPlainString();",
    );
    // definitely NOT the old void/discard shape
    expect(svc).not.toContain("public void describe(");
    expect(svc).not.toContain("public void quote(");
  });

  it("the op route publishes a 200 whose body springdoc infers, plus its derived error set", async () => {
    const ctl = [...(await files())].find(([p]) => p.endsWith("OrdersController.java"))?.[1] ?? "";
    // Wiring nothing boots in this suite: the 200 annotation carries no
    // `content`, so springdoc infers the body from the concrete
    // `ResponseEntity<String>` return (only a union's `ResponseEntity<?>`
    // names one); the error set is the derived operation matrix.
    for (const op of ["describe", "quote"]) {
      const block = ctl.slice(
        ctl.indexOf(`@PostMapping("/{id}/${op}")`),
        ctl.indexOf(` ${op}Order(`),
      );
      expect(block, op).toContain('ApiResponse(responseCode = "200", description = "OK")');
      expect(
        [...block.matchAll(/responseCode = "(\d{3})"/g)].map((m) => m[1]),
        op,
      ).toEqual(["200", "400", "404", "415", "422"]);
    }
  });
});

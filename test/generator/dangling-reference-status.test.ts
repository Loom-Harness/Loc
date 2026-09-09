// A create whose cross-aggregate `X id` is a WELL-FORMED uuid for a row that
// does not exist trips the FK and, on every backend, leaked as a **500**.
// Nothing above the database can catch it: a uuid is only wrong because the row
// is missing, so wire validation has nothing to check. F2's successor — F2 was
// the MALFORMED reference, fixed by publishing + enforcing `format: uuid`.
//
// ── Measured on booted apps, real Postgres, `POST /api/orders` with a
//    `customerId` no customer has ────────────────────────────────────────────
//
//              before                       after
//   node        500 (internal)               422 "The request references a record that does not exist."
//   python      500 (internal)               422 (same)
//   java        409 "…still referenced…"     422 (same)   ← undeclared status AND a nonsense detail
//   dotnet      500 (internal)               422 (same)
//
// 422 is already declared on every write route on every backend, so nothing in
// the published contract moves; the domain floor is where a well-formed request
// refused on SEMANTIC grounds belongs (RFC 9110 §15.5.21), and it resolves
// through the same `httpStatus DomainError -> <Code>` map as every other rung.
//
// ── The SQLSTATE that was wrong in four backends ──────────────────────────
// A cross-aggregate FK is emitted `ON DELETE RESTRICT`, and a RESTRICT check
// raises `restrict_violation` (23001) — NOT `foreign_key_violation` (23503),
// which is what an INSERT raises. Every "still referenced, cannot be deleted"
// arm keyed on 23503, so none of them fired:
//
//   node    still-referenced DELETE → 500      (measured; now 409)
//   java    still-referenced DELETE → 409 "A resource with these values
//                                          already exists."  (the unique arm)
//
// python and dotnet were unaffected: their delete-path arms catch the exception
// CLASS (`IntegrityError` / `DbUpdateException`), not a SQLSTATE. The two codes
// are now the discriminator — 23001 can only come from a delete, 23503 only
// from a write naming an absent row — so no backend needs to inspect the
// request method to tell the two halves of one constraint apart
// (`src/generator/_persistence/pg-sqlstate.ts`).
//
// ── Why the fuzzer never found it ─────────────────────────────────────────
// It found it on python only (F16 / waivers W20+W21). The node leg runs on
// PGlite against a synthesised DDL that carries no foreign keys at all, so its
// clean result was an artefact of the harness; java answered an undeclared 409
// rather than a 500, which `not_a_server_error` does not report (its
// `status_code_conformance` half is very likely what W12 has been absorbing on
// `POST /api/orders/{id}/add_line`). Hence this gate is emitter-level and
// four-backend, not a fuzzer waiver retirement on one leg.
//
// ── Narrowness ────────────────────────────────────────────────────────────
// Gated per project on carrying a cross-aggregate `X id` at all
// (`aggregatesCanTripDanglingReference`), including on a CONTAINED PART —
// `OrderLine.productId` is a FK column reachable from `addLine`, which is the
// operation W11/W12 point at. A reference-free project emits byte-identically.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

/** Two aggregates, `Order` referencing `Customer` at the aggregate level and
 *  `Product` from a contained part, plus a destroy on every one of them (so the
 *  still-referenced arm is in play too). */
const src = (platform: string): string => `
system S {
  subdomain D {
    context C {
      valueobject Money { amount: decimal  currency: string }
      aggregate Customer with crudish {
        name: string
      }
      aggregate Product with crudish {
        sku: string
      }
      aggregate Order with crudish {
        customerId: Customer id
        placedAt: datetime
        contains lines: OrderLine[]

        operation addLine(productId: Product id, unitPrice: Money, qty: int) {
          lines += OrderLine { productId: productId, unitPrice: unitPrice, quantity: qty }
        }

        entity OrderLine {
          productId: Product id
          unitPrice: Money
          quantity: int
        }
      }
      repository Customers for Customer { }
      repository Products for Product { }
      repository Orders for Order { }
    }
  }
  api A from D
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable d { platform: ${platform}, contexts: [C], dataSources: [st], serves: A, port: 4000 }
}
`;

/** The same model with NO cross-aggregate reference anywhere — the byte-identity
 *  control for every gate below. */
const refFree = (platform: string): string => `
system S {
  subdomain D {
    context C {
      aggregate Customer with crudish {
        name: string
      }
      repository Customers for Customer { }
    }
  }
  api A from D
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable d { platform: ${platform}, contexts: [C], dataSources: [st], serves: A, port: 4000 }
}
`;

async function file(source: string, suffix: string): Promise<string> {
  const files = await generateSystemFiles(source);
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return files.get(key as string) as string;
}

const DETAIL = "The request references a record that does not exist.";

describe("the dangling-reference arm answers the declared domain floor", () => {
  it("node maps 23503 to 422 in the router's shared onError", async () => {
    const routes = await file(src("node"), "http/order.routes.ts");
    const onError = routes.slice(routes.indexOf("app.onError("));
    expect(onError).toContain('.cause?.code) === "23503")');
    expect(onError).toContain(
      `return problem(422, "Unprocessable Entity", ${JSON.stringify(DETAIL)});`,
    );
  });

  it("python maps 23503 to 422 in the app-wide IntegrityError handler", async () => {
    const problem = await file(src("python"), "app/http/problem.py");
    expect(problem).toContain('if sqlstate == "23503":');
    expect(problem).toContain(`request, 422, "Unprocessable Entity", "${DETAIL}"`);
  });

  it("dotnet maps 23503 to 422 in the app-wide exception filter", async () => {
    const filter = await file(src("dotnet"), "Api/DomainExceptionFilter.cs");
    expect(filter).toContain('Npgsql.PostgresException { SqlState: "23503" }');
    expect(filter).toContain(
      `Problem(context, 422, "Unprocessable Entity", "${DETAIL}", trace_id)`,
    );
  });

  it("java maps 23503 to 422 in the integrity advice", async () => {
    const advice = await file(src("java"), "api/ApiExceptionAdvice.java");
    expect(advice).toContain('if ("23503".equals(sqlState(e))) {');
    expect(advice).toContain(`problem(422, "Unprocessable Entity", "${DETAIL}", request), 422`);
  });

  it("elixir turns the FK into a changeset error, so the existing 422 arm renders it", async () => {
    const changeset = await file(src("elixir"), "/c/order_changeset.ex");
    expect(changeset).toContain(
      '|> foreign_key_constraint(:customer_id, name: "orders_customer_id_fkey")',
    );
  });
});

describe("the still-referenced arm reads restrict_violation, not foreign_key_violation", () => {
  it("node's delete-path arm accepts 23001", async () => {
    const routes = await file(src("node"), "http/customer.routes.ts");
    expect(routes).toContain('["23001", "23503"].includes(');
    expect(routes).toContain("Customer is still referenced and cannot be deleted.");
  });

  it("java's ReferencedInUse arm keys on 23001 ALONE, so 23503 stays the dangling case", async () => {
    const advice = await file(src("java"), "api/ApiExceptionAdvice.java");
    const restrictAt = advice.indexOf('if ("23001".equals(sqlState(e))) {');
    const fkAt = advice.indexOf('if ("23503".equals(sqlState(e))) {');
    expect(restrictAt).toBeGreaterThan(-1);
    expect(fkAt).toBeGreaterThan(restrictAt);
    // The two arms must not answer the same thing, or the discrimination is a
    // no-op dressed up as one.
    expect(advice.slice(restrictAt, fkAt)).toContain("still referenced and cannot be deleted");
    expect(advice.slice(fkAt)).toContain(DETAIL);
  });
});

describe("a contained part's reference counts", () => {
  it("the part-only reference alone turns the arm on", async () => {
    const partOnly = `
system S {
  subdomain D {
    context C {
      aggregate Product with crudish { sku: string }
      aggregate Order with crudish {
        placedAt: datetime
        contains lines: OrderLine[]
        entity OrderLine { productId: Product id  quantity: int }
      }
      repository Products for Product { }
      repository Orders for Order { }
    }
  }
  api A from D
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable d { platform: python, contexts: [C], dataSources: [st], serves: A, port: 4000 }
}
`;
    const problem = await file(partOnly, "app/http/problem.py");
    expect(problem).toContain('if sqlstate == "23503":');
  });
});

describe("a reference-free project is byte-identical", () => {
  it("python emits no IntegrityError handler at all", async () => {
    const problem = await file(refFree("python"), "app/http/problem.py");
    expect(problem).not.toContain("IntegrityError");
  });

  it("node's onError carries no 23503 arm", async () => {
    const routes = await file(refFree("node"), "http/customer.routes.ts");
    const onError = routes.slice(routes.indexOf("app.onError("));
    expect(onError).not.toContain("23503");
  });

  it("dotnet's filter carries no dangling arm", async () => {
    const filter = await file(refFree("dotnet"), "Api/DomainExceptionFilter.cs");
    expect(filter).not.toContain("23503");
    expect(filter).not.toContain(DETAIL);
  });

  it("java emits no integrity advice", async () => {
    const advice = await file(refFree("java"), "api/ApiExceptionAdvice.java");
    expect(advice).not.toContain("DataIntegrityViolationException");
  });

  it("elixir emits no foreign_key_constraint", async () => {
    const changeset = await file(refFree("elixir"), "customer_changeset.ex");
    expect(changeset).not.toContain("foreign_key_constraint");
  });
});

// M-T6.32 — an `audited` / `provenanced` operation that DECLARES a return type
// gets the returning route, not the void-204 one.
//
// The bug this pins: `emitOperationRoute` dispatched to
// `emitReturningOperationRoute` only when `!audit && !prov`, so
// `operation settle(fee: int): int or NotFound` marked `audited` fell into the
// void handler.  The route then DECLARED 204 only, threw the tagged result
// away, and audited every call — including one that returned its `error`
// variant — as a 204 that never carried the answer.  One keyword silently
// rewrote the HTTP contract, and `loom.audited-returning-operation-unsupported`
// was the honest-but-refusing stopgap (python, .NET, java and elixir all
// emitted both halves already; node was the only backend that could not).
//
// The fix composes the two shapes rather than duplicating either: the audit /
// provenance transaction block is emitted by the SAME helper the void handler
// uses, with `capture: true` carrying the operation's result out of the
// transaction so the ProblemDetails translation runs on the committed value.
// So this file asserts BOTH properties on one route — the 200 with the tagged
// union schema, and the transactional audit write around it.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

function source(persistence?: string): string {
  const platform = persistence ? `node { persistence: ${persistence} }` : "node";
  return `system Depot {
  subdomain Ops {
    context Yard {
      error NotFound { resource: string }
      aggregate Parcel audited with crudish {
        code: string
        weight: int = 0
        operation settle(fee: int): int or NotFound {
          precondition fee >= 0
          weight := weight + fee
          return weight
        }
      }
      repository Parcels for Parcel { }
    }
  }

  api YardApi from Ops
  storage primary { type: postgres }
  resource yardState { for: Yard, kind: state, use: primary }

  deployable d {
    platform: ${platform}
    contexts: [Yard]
    dataSources: [yardState]
    serves: YardApi
    port: 4000
  }
}`;
}

async function routesFor(persistence?: string): Promise<string> {
  const files = await generateSystemFiles(source(persistence));
  const routes = [...files.entries()].find(([p]) => p.endsWith("http/parcel.routes.ts"));
  expect(routes, "no parcel.routes.ts emitted").toBeDefined();
  return routes![1];
}

/** The emitted `settle` handler only — the file also carries the crudish
 *  create/update/destroy routes, and an assertion that matched anywhere in the
 *  file would pass on THEIR audit block while `settle` stayed void (the
 *  §63 shape: a check that never reaches the thing it names). */
function settleHandler(src: string): string {
  const start = src.indexOf('operationId: "settleParcel"');
  expect(start, "no settleParcel route emitted").toBeGreaterThan(-1);
  const end = src.indexOf("app.openapi(", start);
  return src.slice(start, end === -1 ? src.length : end);
}

describe("an audited operation that returns a value gets the returning route", () => {
  it("drizzle: declares 200 with the union schema and keeps the audit write transactional", async () => {
    const handler = settleHandler(await routesFor());

    // 1. The RETURNING route shape: a declared 200 carrying the tagged union,
    //    the error-variant translation, and the result on the success path.
    expect(handler, "the union's 200 must be declared").toContain(
      '200: { description: "OK", content: { "application/json": { schema: intOrNotFound } } }',
    );
    expect(handler, "the error variant must translate to ProblemDetails").toContain(
      'if (result.type === "NotFound") {',
    );
    expect(handler, "the tagged result must reach the client").toContain(
      "return c.json(result, 200);",
    );
    // …and the void handler's terminal answer must NOT be what this route emits.
    expect(handler, "an operation with a declared return type must not answer 204").not.toContain(
      "return c.body(null, 204);",
    );

    // 2. The AUDIT half, unchanged: one transaction around load → mutate → save
    //    → audit insert, the result carried out of it, dispatch after commit
    //    (D-WRITE-TX).
    expect(handler).toContain("const result = await db.transaction(async (tx) => {");
    expect(handler).toContain("const repoTx = new ParcelRepository(tx, __deferred);");
    expect(handler).toContain("const before = repoTx.toWire(aggregate);");
    expect(handler).toContain("const __result = aggregate.settle(body.fee);");
    expect(handler).toContain("const after = repoTx.toWire(aggregate);");
    expect(handler).toContain("await tx.insert(schema.auditRecords).values({");
    expect(handler, "the result must leave the transaction").toContain("return __result;");
    expect(handler).toContain("await __deferred.flush();");

    // 3. Order matters: the ProblemDetails translation runs on the COMMITTED
    //    value, so the audit insert precedes it in the emitted source.
    expect(handler.indexOf("await tx.insert(schema.auditRecords).values({")).toBeLessThan(
      handler.indexOf('if (result.type === "NotFound") {'),
    );
  });

  it("mikroorm: the same route on the other persistence adapter", async () => {
    const handler = settleHandler(await routesFor("mikroorm"));
    expect(handler).toContain("const result = await db.transactional(async (tx) => {");
    expect(handler).toContain("await tx.insert(AuditRecordRow, {");
    expect(handler).toContain("return __result;");
    expect(handler).toContain("return c.json(result, 200);");
    expect(handler).not.toContain("return c.body(null, 204);");
  });

  it("provenanced: a returning operation flushes its provenance rows in the same transaction", async () => {
    // The second half of the retired gate — `provenanced` took the identical
    // void-204 fall-through, so it is pinned on the identical route.
    const files = await generateSystemFiles(`system Depot {
  subdomain Ops {
    context Yard {
      error NotFound { resource: string }
      aggregate Parcel with crudish {
        weight: int
        total: int provenanced
        operation retotal(n: int): int or NotFound {
          total := n * weight
          return total
        }
      }
      repository Parcels for Parcel { }
    }
  }

  api YardApi from Ops
  storage primary { type: postgres }
  resource yardState { for: Yard, kind: state, use: primary }

  deployable d {
    platform: node
    contexts: [Yard]
    dataSources: [yardState]
    serves: YardApi
    port: 4000
  }
}`);
    const src = [...files.entries()].find(([p]) => p.endsWith("http/parcel.routes.ts"))![1];
    const start = src.indexOf('operationId: "retotalParcel"');
    expect(start, "no retotalParcel route emitted").toBeGreaterThan(-1);
    const end = src.indexOf("app.openapi(", start);
    const handler = src.slice(start, end === -1 ? src.length : end);
    expect(handler).toContain("const result = await db.transaction(async (tx) => {");
    expect(handler).toContain("const __prov = aggregate.drainProv();");
    expect(handler).toContain("await tx.insert(schema.provenanceRecords).values({");
    expect(handler).toContain("return __result;");
    expect(handler).toContain("return c.json(result, 200);");
    expect(handler).not.toContain("return c.body(null, 204);");
  });

  it("an UNAUDITED returning operation keeps the plain (non-transactional) shape", async () => {
    // The control: without `audited` the same operation must still emit the
    // direct `repo` path, so the assertions above are attributable to the
    // audit crossing rather than to the returning route in general.
    const files = await generateSystemFiles(
      source().replace("aggregate Parcel audited", "aggregate Parcel"),
    );
    const src = [...files.entries()].find(([p]) => p.endsWith("http/parcel.routes.ts"))![1];
    const handler = settleHandler(src);
    expect(handler).toContain("const result = aggregate.settle(body.fee);");
    expect(handler).toContain("await repo.save(aggregate);");
    expect(handler).not.toContain("db.transaction(");
  });
});

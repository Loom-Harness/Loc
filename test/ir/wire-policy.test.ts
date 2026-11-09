// The wire-policy fact (`src/ir/enrich/wire-policy.ts`): which request input a
// backend refuses, at which status, with which RFC 9457 body, at which stage.
// These pin the fact itself — the owner rulings it encodes and the stage
// order that decides which of two defects wins — independent of any backend
// that renders it.

import { describe, expect, it } from "vitest";
import {
  errorVariantResponse,
  FIELD_LIMIT_REASONS,
  FIELD_REASONS,
  fieldCode,
  fieldFixedMessage,
  fieldLimitChecks,
  fieldParams,
  ingressFor,
  MALFORMED_BODY_DETAIL,
  missingFieldMessage,
  noneVariantResponse,
  ruleStage,
  WIRE_CHECK_ORDER,
  WIRE_REJECTION_CLASSES,
  type WireCheckStage,
  wireFixedDetail,
  wireRejection,
  wireSentenceFor,
  wireStatus,
  wireTitle,
} from "../../src/ir/enrich/wire-policy.js";
import type { InvariantIR, OperationIR } from "../../src/ir/types/loom-ir.js";
import type { SingleFieldPattern } from "../../src/ir/validate/invariant-classify.js";
import { UUID_WIRE_MESSAGE } from "../../src/util/uuid-wire.js";
import { buildLoomModel, enrichedContexts } from "../_helpers/index.js";

const stageIndex = (s: WireCheckStage): number => WIRE_CHECK_ORDER.indexOf(s);

describe("wirePolicy — rejection classes", () => {
  it("every class resolves to a problem+json about:blank body at a known stage", () => {
    for (const cls of WIRE_REJECTION_CLASSES) {
      const r = wireRejection(cls);
      expect(r.contentType, cls).toBe("application/problem+json");
      expect(r.type, cls).toBe("about:blank");
      expect(stageIndex(r.stage), `${cls} stage`).toBeGreaterThanOrEqual(0);
      expect(r.title.length, `${cls} title`).toBeGreaterThan(0);
    }
  });

  it("malformed input is 400 / 415 at the transport stage; a bad field is 422 at the schema stage", () => {
    expect(wireRejection("malformed-body")).toMatchObject({
      status: 400,
      title: "Bad Request",
      stage: "transport",
      errors: "none",
    });
    expect(wireFixedDetail("malformed-body")).toBe("Malformed JSON in request body");
    expect(wireRejection("unsupported-media-type")).toMatchObject({
      status: 415,
      stage: "transport",
    });
    expect(wireFixedDetail("unsupported-media-type")).toBe("Content-Type must be application/json");
    // RS-29: the validation rung is NOT titled with the 422 reason phrase.
    expect(wireRejection("field-invalid")).toMatchObject({
      status: 422,
      title: "Validation failed",
      errors: "per-field",
      stage: "schema",
    });
    expect(wireFixedDetail("field-invalid")).toBe("One or more fields are invalid.");
  });

  it("the domain rungs resolve through `httpStatus` overrides; their title follows the status", () => {
    expect(wireRejection("domain-floor")).toMatchObject({
      status: 422,
      title: "Unprocessable Entity",
      resolves: "DomainError",
      stage: "domain",
    });
    expect(wireStatus("domain-floor", { DomainError: 400 })).toBe(400);
    expect(wireTitle("domain-floor", { DomainError: 400 })).toBe("Bad Request");
    // The framework tiers never move.
    expect(wireStatus("field-invalid", { DomainError: 400 })).toBe(422);
    expect(wireStatus("malformed-body", { DomainError: 422 })).toBe(400);
    expect(wireStatus("not-found", { NotFound: 410 })).toBe(410);
    expect(wireTitle("not-found", { NotFound: 410 })).toBe("Gone");
  });

  it("the 409s: a state gate is titled `Disallowed`, a lost version race and a unique key `Conflict`", () => {
    expect(wireRejection("state-gate")).toMatchObject({
      status: 409,
      title: "Disallowed",
      stage: "state-gate",
    });
    expect(wireRejection("version-conflict")).toMatchObject({
      status: 409,
      title: "Conflict",
      stage: "persist",
    });
    expect(wireSentenceFor("version-conflict", "Note 7")).toBe(
      "Note 7 was modified by another request",
    );
    expect(wireRejection("unique-conflict")).toMatchObject({ status: 409, title: "Conflict" });
    // A dangling reference is refused on semantic grounds — the domain floor's
    // status, not a conflict.
    expect(wireStatus("dangling-reference")).toBe(422);
  });

  it("the sentences: by-id not-found, the routing 404, a malformed If-Match", () => {
    expect(wireSentenceFor("not-found", "Order 7")).toBe("Order 7 not found");
    expect(wireSentenceFor("no-route", "GET /x")).toBe("no route for GET /x");
    expect(wireSentenceFor("malformed-if-match", "abc")).toBe("Malformed If-Match header: abc");
    expect(() => wireFixedDetail("not-found")).toThrow(/no fixed detail/);
  });

  it("a 500 never echoes the fault (RS-28)", () => {
    expect(wireRejection("internal")).toMatchObject({
      status: 500,
      title: "Internal Server Error",
    });
    expect(wireFixedDetail("internal")).toBe("internal");
  });
});

describe("wirePolicy — field reasons", () => {
  it('a missing required field is `"<field> is required"` (#3881)', () => {
    expect(missingFieldMessage("title")).toBe("title is required");
    expect(FIELD_REASONS.missing).toEqual({ kind: "field-sentence", suffix: "is required" });
  });

  it("a malformed `X id` inside well-formed JSON is a field refusal, never a 400 (#3508)", () => {
    expect(ingressFor("guid").shapeReason).toBe("malformed-id");
    expect(fieldFixedMessage("malformed-id")).toBe(UUID_WIRE_MESSAGE);
  });

  it("the fixed range sentences", () => {
    expect(fieldFixedMessage("integer-range")).toBe("Integer out of range");
    expect(FIELD_REASONS["money-grammar"]).toEqual({
      kind: "value-sentence",
      prefix: "Invalid decimal",
    });
    expect(FIELD_REASONS["money-range"]).toEqual({
      kind: "value-sentence",
      prefix: "Money out of range",
    });
  });
});

describe("wirePolicy — ingress (D-NUMERIC-INGRESS-STRICT, #3880; #3721)", () => {
  it("a numeric field accepts only a JSON number; money only its string form", () => {
    for (const p of ["int", "long", "decimal"] as const)
      expect(ingressFor(p).json, p).toBe("number");
    expect(ingressFor("money").json).toBe("string");
    expect(ingressFor("money").shapeReason).toBe("money-grammar");
    expect(ingressFor("int").rangeReason).toBe("integer-range");
  });

  it('`""` is a valid required string; nothing else admits it', () => {
    expect(ingressFor("string").emptyStringValid).toBe(true);
    for (const p of ["int", "money", "guid", "datetime", "bool"] as const)
      expect(ingressFor(p).emptyStringValid, p).toBe(false);
  });
});

describe("wirePolicy — stages", () => {
  it("transport → schema → authorize → load → state-gate → domain → persist", () => {
    expect(WIRE_CHECK_ORDER).toEqual([
      "transport",
      "schema",
      "authorize",
      "load",
      "state-gate",
      "domain",
      "persist",
      "fault",
    ]);
    // A malformed body to an absent id is a 400; a bad field to an absent id a 422.
    expect(stageIndex(wireRejection("malformed-body").stage)).toBeLessThan(
      stageIndex(wireRejection("not-found").stage),
    );
    expect(stageIndex(wireRejection("field-invalid").stage)).toBeLessThan(
      stageIndex(wireRejection("not-found").stage),
    );
    expect(stageIndex(wireRejection("state-gate").stage)).toBeLessThan(
      stageIndex(wireRejection("domain-floor").stage),
    );
  });

  it("a param-only precondition is a schema check; one reading the row is a domain check (#3584)", async () => {
    const loom = await buildLoomModel(`
system Shop {
  subdomain S {
    context Store {
      aggregate Product with crudish {
        stock: int
        operation restock(n: int) {
          precondition n > 0
          stock := stock + n
        }
        operation ship(q: int) {
          precondition q <= stock
          stock := stock - q
        }
      }
      repository Products for Product { }
    }
  }
  storage primary { type: postgres }
  resource st { for: Store, kind: state, use: primary }
  deployable api { platform: node contexts: [Store] dataSources: [st] port: 3000 }
}`);
    const product = enrichedContexts(loom)
      .find((c) => c.name === "Store")!
      .aggregates.find((a) => a.name === "Product")!;
    const pre = (op: OperationIR): InvariantIR => {
      const s = op.statements.find((x) => x.kind === "precondition")!;
      if (s.kind !== "precondition") throw new Error("unreachable");
      return { expr: s.expr, source: s.source, message: s.message };
    };
    const op = (n: string) => product.operations.find((o) => o.name === n)!;
    const params = (o: OperationIR) => new Set(o.params.map((p) => p.name));
    expect(ruleStage(pre(op("restock")), params(op("restock")))).toBe("schema");
    expect(ruleStage(pre(op("ship")), params(op("ship")))).toBe("domain");
  });
});

describe("wirePolicy — declared error variants (#3504)", () => {
  it("is problem+json at the mapped status with its own type URI, never a 200", () => {
    expect(errorVariantResponse("NotFound")).toEqual({
      status: 404,
      title: "Not Found",
      detail: "Not Found",
      type: "/errors/not-found",
      contentType: "application/problem+json",
      stage: "domain",
    });
    expect(errorVariantResponse("OutOfStock").status).toBe(500);
    expect(errorVariantResponse("OutOfStock", { OutOfStock: 409 }).status).toBe(409);
    expect(noneVariantResponse().status).toBe(404);
  });
});

it("MALFORMED_BODY_DETAIL is the text hono's json validator raises", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(
    new URL("../../node_modules/hono/dist/validator/validator.js", import.meta.url),
    "utf8",
  );
  expect(src).toContain(JSON.stringify(MALFORMED_BODY_DETAIL));
});

// A declared field limit answers one code per side, the bound in `params`
// (#4473, owner decision 2026-11-08).  `fieldLimitChecks` is the one mapping
// every backend and client validator reads.
describe("field limits — fieldLimitChecks", () => {
  const codes = (p: SingleFieldPattern) =>
    fieldLimitChecks(p).map((c) => ({ code: fieldCode(c.reason), params: c.params }));

  it("maps each single-field pattern onto its sides", () => {
    expect(codes({ kind: "min", n: 1 })).toEqual([{ code: "field.min", params: { min: 1 } }]);
    expect(codes({ kind: "min", n: 0.5, exclusive: true })).toEqual([
      { code: "field.greater-than", params: { min: 0.5 } },
    ]);
    expect(codes({ kind: "max", n: 10 })).toEqual([{ code: "field.max", params: { max: 10 } }]);
    expect(codes({ kind: "max", n: 9.5, exclusive: true })).toEqual([
      { code: "field.less-than", params: { max: 9.5 } },
    ]);
    expect(codes({ kind: "between", lo: 1, hi: 10 })).toEqual([
      { code: "field.min", params: { min: 1 } },
      { code: "field.max", params: { max: 10 } },
    ]);
    expect(codes({ kind: "len-min", n: 2 })).toEqual([
      { code: "field.min-length", params: { min: 2 } },
    ]);
    expect(codes({ kind: "len-max", n: 5 })).toEqual([
      { code: "field.max-length", params: { max: 5 } },
    ]);
    expect(codes({ kind: "len-eq", n: 4 })).toEqual([
      { code: "field.length", params: { length: 4 } },
    ]);
    expect(codes({ kind: "len-range", lo: 2, hi: 5 })).toEqual([
      { code: "field.min-length", params: { min: 2 } },
      { code: "field.max-length", params: { max: 5 } },
    ]);
    expect(codes({ kind: "regex", pattern: "^a$" })).toEqual([
      { code: "field.pattern", params: {} },
    ]);
  });

  it("every check carries exactly the params its reason names, and its bound", () => {
    const all: SingleFieldPattern[] = [
      { kind: "min", n: 1 },
      { kind: "min", n: 1, exclusive: true },
      { kind: "max", n: 1 },
      { kind: "max", n: 1, exclusive: true },
      { kind: "between", lo: 1, hi: 2 },
      { kind: "len-min", n: 1 },
      { kind: "len-max", n: 1 },
      { kind: "len-eq", n: 1 },
      { kind: "len-range", lo: 1, hi: 2 },
      { kind: "regex", pattern: "x" },
    ];
    const reached = new Set<string>();
    for (const p of all)
      for (const c of fieldLimitChecks(p)) {
        reached.add(c.reason);
        expect(Object.keys(c.params).sort()).toEqual([...fieldParams(c.reason)].sort());
        if (c.reason === "pattern") expect(c.regex).toBe("x");
        else expect(Object.values(c.params)).toEqual([c.bound]);
        expect(FIELD_REASONS[c.reason]).toEqual({ kind: "limit" });
      }
    expect([...reached].sort()).toEqual([...FIELD_LIMIT_REASONS].sort());
  });
});

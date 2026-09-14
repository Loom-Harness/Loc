// `str + datetime` — the one operand pair Python refuses to combine, reachable
// from ordinary source.
//
// An interpolated template whose hole carries an ICU date/time format —
// `` `on {startAt, date}` `` — is ACCEPTED by the validator precisely because
// the format lifts the bare-hole rejection (`loom.interp-hole-type`; a bare
// `{startAt}` is refused).  It lowers to a `+`-chain whose datetime operand is
// NOT wrapped in the `string(…)` convert a numeric hole gets, and every other
// backend's `+` coerces silently (JS `String`, C# / Java `ToString`).  Python
// raises:
//
//     TypeError: can only concatenate str (not "datetime.datetime") to str
//
// at REQUEST time, on every read of the aggregate — a 500, not a wrong string.
// Verified by running the emitted property in `python:3.13-slim`: before the
// fix it raised the above at `appt.py:48`; after, `d1` returns
// `'on 2026-10-01T09:00:00+00:00'`.
//
// Two halves, both asserted here:
//   1. `bodyTypeOf` sees through the transparent `i18nFormat` wrapper, so the
//      hole's datetime type is visible to a type probe at all.
//   2. the Python `+` leaf lifts that operand through `.isoformat()` — the
//      same spelling `renderPyConvert` emits for an explicit
//      `string(x: datetime)` and the synthesized `inspect` already uses.

import { NodeFileSystem } from "langium/node";
import { parseHelper } from "langium/test";
import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../../src/ir/lower/lower.js";
import { createDddServices } from "../../../src/language/ddd-module.js";
import type { Model } from "../../../src/language/generated/ast.js";
import { bodyTypeOf } from "../../../src/util/expr-body-type.js";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = `system S {
  subdomain M { context C {
    aggregate Appt {
    startAt: datetime
    n: int
    derived d1: string = \`on {startAt, date}\`
    derived d2: string = \`at {startAt, time}\`
    derived d3: string = \`n {n, number}\`
    }
    repository Appts for Appt { }
  } }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: python, contexts: [C], dataSources: [st], port: 8000 }
}`;

async function parsed() {
  const services = createDddServices(NodeFileSystem);
  const helper = parseHelper<Model>(services.Ddd);
  const doc = await helper(SRC, { validation: true });
  return doc.parseResult.value as Model;
}

/** The emitted `domain/appt.py`, through the shared helper (which also asserts
 *  phases ① / ④ / ⑦ accept the fixture). */
async function apptPy(): Promise<string> {
  const files = await generateSystemFiles(SRC);
  return [...files.entries()].find(([k]) => k.endsWith("domain/appt.py"))?.[1] ?? "";
}

async function model() {
  return enrichLoomModel(lowerModel(await parsed()));
}

describe("python — a datetime interpolated into a string", () => {
  it("lifts the datetime operand through .isoformat() so the concat is legal", async () => {
    const agg = await apptPy();
    expect(agg).toContain('return "on " + self._start_at.isoformat()');
    expect(agg).toContain('return "at " + self._start_at.isoformat()');
    // The bare `str + datetime` that raises must not appear anywhere.
    expect(agg).not.toMatch(/\+ self\._start_at(?!\.)/);
  });

  it("leaves a non-datetime hole alone", async () => {
    // The ratchet in the other direction: the lift is keyed on the operand
    // pair, so an int hole keeps the `str(...)` convert lowering already gives
    // it and gains no spurious `.isoformat()`.
    const agg = await apptPy();
    expect(agg).toContain('"n " + str(self._n)');
    expect(agg).not.toContain("self._n.isoformat()");
  });

  it("bodyTypeOf sees through the transparent i18nFormat wrapper", async () => {
    // The wrapper is documented as transparent (every backend renders `inner`
    // and drops the format); before this it hid its operand's type from every
    // consumer that asks what an expression is, which is the root cause above.
    const loom = await model();
    const agg = loom.systems[0]!.subdomains[0]!.contexts[0]!.aggregates[0]!;
    const d1 = agg.derived.find((d) => d.name === "d1")!;
    expect(d1.expr.kind).toBe("binary");
    const rhs = (d1.expr as Extract<typeof d1.expr, { kind: "binary" }>).right;
    expect(rhs.kind).toBe("i18nFormat");
    expect(bodyTypeOf(rhs)).toEqual({ kind: "primitive", name: "datetime" });
  });
});

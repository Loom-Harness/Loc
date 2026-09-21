// Sweep F-029 — a `derived` doing decimal arithmetic over a value object's
// fields made EVERY read of that aggregate return HTTP 500 on Phoenix alone.
//
// Three shapes of the same field disagree about its Elixir runtime type:
//   - `decimal` in its OWN column           → loads as `%Decimal{}`
//   - the same field inside an EMBEDDED VO  → jsonb, so it loads as a FLOAT
//   - a literal in the source               → already coerced at the call site
//
// `Decimal.mult/2` refuses an implicit float ("implicit conversion of 1.0 to
// Decimal is not allowed"), so `derived footprint = size.width * size.height`
// compiled green, booted green, accepted the POST — and then raised inside
// `serialize/1` on every GET.  Invisible to every compile-tier gate: nothing
// is wrong with the Elixir until a row comes back out of the database.
//
// The gate is the invariant, not the one field: NO `Decimal.*` arithmetic in
// the generated project may take a bare embedded-VO `Map.get(...)` read as an
// operand.  A raw `Map.get` there is exactly the defect — whatever expression
// produced it.

import { beforeAll, describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = `
system F029 {
  subdomain S {
    context C {
      valueobject Dimensions {
        width: decimal
        height: decimal
      }
      valueobject Price {
        net: money
        tax: money
      }
      aggregate Product with crudish {
        name: string
        size: Dimensions
        price: Price
        weight: decimal
        derived footprint: decimal = size.width * size.height
        derived gross: money = price.net + price.tax
        derived heavy: decimal = weight * weight
      }
      repository Products for Product { }
    }
  }
  api CApi from S
  storage primary { type: postgres }
  resource cState { for: C, kind: state, use: primary }
  deployable api {
    platform: elixir
    contexts: [C]
    dataSources: [cState]
    serves: CApi
    port: 4000
  }
}
`;

/** Split an argument list on its TOP-LEVEL commas only — a naive split cuts
 *  `Map.get(m, :k, default)` into three fragments, one of which starts with
 *  `Map.get(` no matter how the call is wrapped, so the detector would report
 *  the coerced form as an offender too (it did, on the first run). */
function topLevelArgs(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      out.push(args.slice(last, i).trim());
      last = i + 1;
    }
  }
  out.push(args.slice(last).trim());
  return out;
}

/** Every `Decimal.<fn>(...)` call's argument text, brace-matched so a nested
 *  call is captured whole rather than truncated at the first `)`. */
function decimalCallArgs(src: string): { args: string; call: string }[] {
  const out: { args: string; call: string }[] = [];
  for (const m of src.matchAll(/\bDecimal\.(mult|add|sub|div|compare)\(/g)) {
    let depth = 1;
    let i = (m.index ?? 0) + m[0].length;
    const start = i;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") depth--;
    }
    out.push({ args: src.slice(start, i - 1), call: m[1] as string });
  }
  return out;
}

describe("embedded value-object decimal reads (F-029)", () => {
  let elixir: [string, string][] = [];
  let serializer = "";
  beforeAll(async () => {
    const files = await generateSystemFiles(SRC);
    elixir = [...files.entries()].filter(([p]) => p.endsWith(".ex") || p.endsWith(".exs"));
    serializer = elixir.find(([p]) => p.includes("product_controller"))?.[1] ?? "";
  });

  it("emits Elixir for the probe", () => {
    expect(elixir.length).toBeGreaterThan(0);
  });

  it("never hands a bare embedded-VO Map.get read to Decimal arithmetic", () => {
    const offenders: string[] = [];
    for (const [path, content] of elixir) {
      for (const { args, call } of decimalCallArgs(content)) {
        // A coerced read is wrapped (`case Decimal.cast(Map.get(...)) do …`),
        // so the Map.get is no longer an OPERAND — it sits inside the cast.
        for (const arg of topLevelArgs(args)) {
          if (arg.startsWith("Map.get(")) offenders.push(`${path}: Decimal.${call}(… ${arg} …)`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("coerces the read itself, so a nil optional field fail-softs instead of raising", () => {
    expect(serializer).toContain("Decimal.cast(");
    // The `_ ->` arm returns the uncoerced read unchanged: `Decimal.cast(nil)`
    // answers `:error`, so an absent field stays nil rather than becoming 0.
    expect(serializer).toMatch(
      /case Decimal\.cast\(Map\.get\(.*?do \{:ok, __d\} -> __d; _ -> Map\.get\(/,
    );
  });

  it("leaves a plain column-backed decimal read alone (it is already %Decimal{})", () => {
    // `weight * weight` reads two real columns — no cast needed, and adding one
    // would hide a genuine type error behind a coercion.
    expect(serializer).toMatch(/Decimal\.mult\(record\.weight, record\.weight\)/);
  });
});

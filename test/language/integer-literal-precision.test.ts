// `loom.integer-literal-imprecise` — the compile-time half of the `long`
// safe-integer ceiling (M-T5.23 / `D-LONG-AVG-DEFAULTS`).
//
// The `INT` terminal returns a JS `number`, so a literal past 2^53 is rounded
// before any phase can see it.  Measured on `main` @ `09427a5`:
// `derived big: long = 9007199254740993` validated clean and emitted
// `return 9007199254740992;` on node — and .NET/java/elixir, which carry int64
// exactly, emitted the same rounded value, because the written digits never
// reached the IR.  One gate at the literal covers all five targets.

import { describe, expect, it } from "vitest";
import { parseString } from "../_helpers/index.js";

const SYSTEM = (member: string) => `system Lits {
  subdomain D { context C {
    aggregate Thing with crudish {
      name: string
      sold: long
      count: int
${member}
    }
    repository Things for Thing { }
  } }
  api Api from D
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable d { platform: node contexts: [C] dataSources: [st] serves: Api port: 3000 }
}`;

async function errorsFor(member: string): Promise<string[]> {
  const { errors } = await parseString(SYSTEM(member));
  return errors;
}

describe("an integer literal the toolchain cannot hold exactly is refused", () => {
  it("refuses 2^53 + 1 in a derived body, naming both the written and the held value", async () => {
    const errs = await errorsFor("      derived big: long = 9007199254740993");
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain("9007199254740993");
    // Naming the value the toolchain actually holds is the whole point: the
    // author cannot see the rounding any other way.
    expect(errs[0]).toContain("9007199254740992");
  });

  it("accepts the largest value the contract carries, and refuses the next one", async () => {
    // The bound is inclusive, so a gate off by one here would refuse a legal
    // literal.
    expect(await errorsFor("      derived big: long = 9007199254740991")).toEqual([]);
    // 2^53 itself is representable in float64 but is one PAST the declared
    // ceiling — the same value the node wire guard refuses.  The literal gate
    // and the wire boundary share `isExactInteger`, so they cannot disagree.
    expect(await errorsFor("      derived big: long = 9007199254740992")).toHaveLength(1);
    expect(await errorsFor("      derived big: long = 9007199254740993")).toHaveLength(1);
  });

  it("fires wherever a literal is written, not only in a derived body", async () => {
    // A comparison inside an invariant reaches the same emitters.
    const inv = await errorsFor("      invariant sold < 9007199254740993");
    expect(inv.some((e) => e.includes("outside the range Loom carries exactly"))).toBe(true);
  });

  it("says nothing about ordinary literals, including leading zeros", async () => {
    expect(await errorsFor("      derived small: int = 42")).toEqual([]);
    // `007` is a spelling difference, not a precision loss — a naive
    // text-vs-String(value) comparison would have reported it.
    expect(await errorsFor("      derived padded: int = 007")).toEqual([]);
  });
});

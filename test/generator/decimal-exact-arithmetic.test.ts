import { describe, expect, it } from "vitest";
import { generateCorpusCase } from "../fixtures/corpus/harness.js";

// ---------------------------------------------------------------------------
// RS-37 (M-T5.22, D-DECIMAL-EXACT-MOMENT) — `decimal` arithmetic is EXACT.
//
// The runtime proof is the `decimal-exact` witness on the seven behavioural
// legs (unit + api + wire golden).  Those legs are path-scoped and boot a
// backend, so this file is the per-PR, no-boot pin of the SHAPE the two
// changed backends emit for the witness's rows: each chain lifted into a
// decimal type and narrowed back to the double domain type exactly ONCE, at
// its root.  The narrowing count is the assertion that matters — a renderer
// that narrows per step still computes each step exactly, passes every
// "does it use Decimal" check, and answers 0.09999999999999999 for
// `0.1 / 3 * 3` (the witness's `thirds` row).
// ---------------------------------------------------------------------------

async function file(backend: "node" | "python", path: string): Promise<string> {
  const files = await generateCorpusCase("decimal-exact", backend);
  const content = files.get(path);
  if (content === undefined) {
    throw new Error(
      `${backend}: ${path} not emitted; got ${[...files.keys()].slice(0, 20).join(", ")}`,
    );
  }
  return content;
}

/** The body of the one-line getter `get <name>(): number { return …; }`. */
function tsGetter(src: string, name: string): string {
  const m = new RegExp(`get ${name}\\(\\): number \\{ return (.*); \\}`).exec(src);
  if (!m) throw new Error(`no getter '${name}' in:\n${src}`);
  return m[1];
}

/** The `return …` line of the python property `def <name>(self) -> float:`. */
function pyProperty(src: string, name: string): string {
  const m = new RegExp(`def ${name}\\(self\\) -> float:\\n\\s+return (.*)`).exec(src);
  if (!m) throw new Error(`no property '${name}' in:\n${src}`);
  return m[1];
}

const count = (s: string, needle: string): number => s.split(needle).length - 1;

describe("RS-37 — node computes decimal arithmetic through decimal.js", () => {
  it("lifts a binary and narrows once", async () => {
    const src = await file("node", "d/domain/sample.ts");
    expect(tsGetter(src, "sum")).toBe("new Decimal(this._a).plus(this._b).toNumber()");
    expect(tsGetter(src, "ratio")).toBe("new Decimal(this._d).div(this._a).toNumber()");
  });

  it("carries a chain's Decimal to its root — one `.toNumber()`, not one per step", async () => {
    const src = await file("node", "d/domain/sample.ts");
    expect(tsGetter(src, "cube")).toBe(
      "new Decimal(this._c).times(this._c).times(this._c).toNumber()",
    );
    // `(a + b) * 3 - d` — the paren is kept, the inner narrowing is not.
    expect(tsGetter(src, "mixed")).toBe(
      "(new Decimal(this._a).plus(this._b)).times(3).minus(this._d).toNumber()",
    );
    for (const name of ["cube", "mixed", "thirds"]) {
      expect(count(tsGetter(src, name), ".toNumber()"), name).toBe(1);
    }
  });

  it("folds a decimal `sum` and rounds a decimal half-away-from-zero on the exact value", async () => {
    const src = await file("node", "d/domain/sample.ts");
    expect(tsGetter(src, "partsWeight")).toContain("new Decimal(0)");
    expect(tsGetter(src, "partsWeight")).toMatch(/acc\.plus\(/);
    expect(tsGetter(src, "rounded")).toBe(
      "new Decimal(this._tie).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber()",
    );
  });

  it("an operation's computed write is exact too", async () => {
    const src = await file("node", "d/domain/sample.ts");
    expect(src).toContain("this._total = new Decimal(this._total).plus(x).toNumber();");
  });

  it("imports decimal.js in a money-free aggregate, and package.json declares it", async () => {
    const src = await file("node", "d/domain/sample.ts");
    expect(src).toContain('import Decimal from "decimal.js";');
    const pkg = JSON.parse(await file("node", "d/package.json"));
    expect(Object.keys(pkg.dependencies)).toContain("decimal.js");
  });
});

describe("RS-37 — python computes decimal arithmetic on Decimal(str(x))", () => {
  it("lifts a binary and narrows once", async () => {
    const src = await file("python", "d/app/domain/sample.py");
    expect(pyProperty(src, "sum")).toBe("float(Decimal(str(self._a)) + Decimal(str(self._b)))");
    expect(pyProperty(src, "ratio")).toBe("float(Decimal(str(self._d)) / Decimal(str(self._a)))");
  });

  it("carries a chain's Decimal to its root — one `float(`, not one per step", async () => {
    const src = await file("python", "d/app/domain/sample.py");
    expect(pyProperty(src, "thirds")).toBe(
      'float((Decimal(str(self._a)) / Decimal("3")) * Decimal("3"))',
    );
    for (const name of ["cube", "mixed", "thirds"]) {
      expect(count(pyProperty(src, name), "float("), name).toBe(1);
    }
  });

  it("folds a decimal `sum` from Decimal(0) and rounds by quantize(ROUND_HALF_UP)", async () => {
    const src = await file("python", "d/app/domain/sample.py");
    expect(pyProperty(src, "parts_weight")).toContain("Decimal(0)");
    expect(pyProperty(src, "rounded")).toContain('rounding="ROUND_HALF_UP"');
    expect(pyProperty(src, "rounded")).not.toContain("math.");
    expect(src).toContain("from decimal import Decimal");
  });
});

import { describe, expect, it } from "vitest";
import { parseString } from "../../_helpers/parse.js";

const unit = (stmt: string): string => `
system S {
  subdomain D { context C {
    aggregate Thing with crudish { name: string  total: int }
    repository Things for Thing { }
    test "matcher" for Thing {
      ${stmt}
    }
  } }
}`;

const codes = async (src: string): Promise<string[]> => {
  const { diagnostics } = await parseString(src);
  return diagnostics.map((d) => String(d.code ?? ""));
};

describe("negated toThrow", () => {
  it("refuses .not.toThrow()", async () => {
    expect(await codes(unit('expect("x").not.toThrow()'))).toContain("loom.not-throw-invalid");
  });

  it("keeps the plain toThrow() and the negatable matchers clean", async () => {
    expect(await codes(unit('expect("x").toThrow()'))).not.toContain("loom.not-throw-invalid");
    expect(await codes(unit('expect("x").not.toBe("y")'))).not.toContain("loom.not-throw-invalid");
  });
});

// A member of a `T?` value is refused unless the value is narrowed: one rule
// for a field read, a scalar property, an intrinsic call and a collection op.

import { describe, expect, it } from "vitest";
import { lspCodes } from "../../_helpers/diagnostics.js";
import { parseString } from "../../_helpers/parse.js";

const sys = (members: string) => `
system Demo {
  subdomain S {
    context C {
      valueobject Addr { city: string }
      aggregate R with crudish {
        name: string
        note: string?
        tags: string[]?
        addr: Addr?
        ${members}
      }
    }
  }
}`;

async function codes(members: string): Promise<string[]> {
  const { diagnostics } = await parseString(sys(members), { validate: true });
  return lspCodes(diagnostics);
}

const NULLABLE = "loom.nullable-receiver";

describe("loom.nullable-receiver", () => {
  it.each([
    ["a scalar property", "derived len: int = note.length"],
    ["an intrinsic call", "derived up: string = note.toUpper()"],
    ["a value-object field", "derived city: string = addr.city"],
    ["a collection op", "derived n: int = tags.count"],
    ["a field read through `this`", "derived len: int = this.note.length"],
  ])("refuses %s on a `T?` receiver", async (_what, member) => {
    expect(await codes(member)).toEqual([NULLABLE]);
  });

  it.each([
    ["a guarded name", "derived len: int = note != null ? note.length : 0"],
    ["a guarded `this` path", "derived len: int = this.note != null ? this.note.length : 0"],
    ["a guarded value-object read", 'derived city: string = addr != null ? addr.city : ""'],
    ["the null branch of `== null`", "derived len: int = note == null ? 0 : note.length"],
    ["a later `&&` operand", "derived some: bool = note != null && note.length > 0"],
    ["a later `||` operand", "invariant note == null || note.length <= 10"],
    [
      "a ternary on an `&&` condition",
      'derived up: string = note != null && name != "" ? note.toUpper() : ""',
    ],
  ])("admits %s", async (_what, member) => {
    expect(await codes(member)).toEqual([]);
  });

  it.each([
    ["an earlier `&&` operand", "derived some: bool = note.length > 0 && note != null"],
    ["an `||` operand after `!= null`", "derived some: bool = note != null || note.length > 0"],
    [
      "the else branch of an `&&` condition",
      'derived up: string = note != null && name != "" ? "" : note.toUpper()',
    ],
  ])("does not narrow %s", async (_what, member) => {
    expect(await codes(member)).toEqual([NULLABLE]);
  });

  it("does not narrow across an operation call between the test and the use", async () => {
    expect(
      await codes(`
        operation bump(): bool { note := null  return true }
        derived some: bool = note != null && bump() && note.length > 0`),
    ).toContain(NULLABLE);
  });

  it("does not narrow a different path than the one the guard tests", async () => {
    expect(await codes('derived city: string = note != null ? addr.city : ""')).toEqual([NULLABLE]);
  });

  it("leaves a member that does not exist to the member checks", async () => {
    const c = await codes('derived x: string = note.totallyMadeUp("")');
    expect(c).toContain("loom.intrinsic-unknown");
    expect(c).not.toContain(NULLABLE);
  });

  it("does not count a test matcher as a dereference", async () => {
    const c = await codes(`
      test "a supplied optional survives" {
        let r = R.create({ name: "n", note: "kept" })
        expect(r.note).toBe("kept")
      }`);
    expect(c).not.toContain(NULLABLE);
  });

  it("reports one diagnostic per chain", async () => {
    expect(await codes("derived len: int = addr.city.length")).toEqual([NULLABLE]);
  });
});

describe("loom.nullable-receiver in a frontend body", () => {
  const ui = (body: string) => `
system Demo {
  subdomain S {
    context C {
      valueobject Addr { city: string }
      aggregate R with crudish { name: string  note: string?  addr: Addr? }
      repository Rs for R { }
    }
  }
  api A from S
  ui Web {
    api A: A
    page P(r: R) { route: "/p/:id" body: Stack { ${body} } }
  }
}`;
  const uiCodes = async (body: string) =>
    lspCodes((await parseString(ui(body), { validate: true })).diagnostics);

  it("admits a field read off a nullable value object — the frontends spell it `?.`", async () => {
    expect(await uiCodes("Text { r.addr.city }")).toEqual([]);
  });

  it("still refuses a call on a nullable receiver", async () => {
    expect(await uiCodes("Text { r.addr.city }, Text { r.note.toUpper() }")).toEqual([NULLABLE]);
  });
});

// Writes and rebindings a target cannot render: an assignment whose head is a
// local (`loom.assign-to-local`), a write through a local holding a part
// (`loom.assign-through-local-unsupported`), and a `let` that rebinds a name
// already bound in its body (`loom.duplicate-let`).  Each used to validate
// clean and lower to a write to a member that does not exist, or to a
// redeclared local — a compile error or a silent runtime bug on every backend.

import { describe, expect, it } from "vitest";
import { parseString } from "../../_helpers/parse.js";

const model = (members: string) => `
system R { subdomain S { context C {
  enum St { Open, Done }
  aggregate Case with crudish {
    title: string
    status: St
    contains tasks: Task[]
${members}
    entity Task { code: string  status: St }
  }
  repository Cases for Case { }
} } }
`;

async function codes(src: string): Promise<string[]> {
  const { diagnostics } = await parseString(src, { validate: true });
  return diagnostics
    .filter((d) => d.severity === 1)
    .map((d) => String((d as { code?: unknown }).code ?? d.message));
}

describe("an assignment writes a member, never a local", () => {
  it("refuses a head that is a `let` or a parameter", async () => {
    expect(await codes(model("operation t() { let x = 1\n x := 2 }"))).toEqual(["loom.assign-to-local"]);
    expect(await codes(model('operation u(n: string) { n := "a" }'))).toEqual(["loom.assign-to-local"]);
  });

  it("refuses a write through a local holding a part (#5179)", async () => {
    const src = model(`operation finish(code: string) {
      precondition tasks.any(t => t.code == code)
      let task = tasks.where(t => t.code == code).first
      task.status := Done
    }`);
    expect(await codes(src)).toEqual(["loom.assign-through-local-unsupported"]);
  });

  it("accepts a head that names a member, even when a local shadows it", async () => {
    expect(await codes(model("operation r(title: string) { title := title }"))).toEqual([]);
    expect(await codes(model('operation s() { let title = "x"\n this.title := title }'))).toEqual([]);
  });
});

describe("a `let` binds a name once per body", () => {
  it("refuses a `let` rebinding an earlier `let` in its block (#4793)", async () => {
    expect(await codes(model("operation v() { let y = 1\n let y = 2 }"))).toEqual(["loom.duplicate-let"]);
  });

  it("refuses a `let` shadowing an enclosing `let` or a parameter", async () => {
    const nested = model(`operation w() { let n = 1
      if n == 1 { let n = 2
        title := "x" } }`);
    expect(await codes(nested)).toEqual(["loom.duplicate-let"]);
    const param = model(`operation p(code: string) { let code = "b"
      title := code }`);
    expect(await codes(param)).toEqual(["loom.duplicate-let"]);
  });

  it("accepts the same name in sibling branches and a `let` named like a member", async () => {
    const siblings = model(`operation q(code: string) {
      if code == "a" { let n = 1
        title := "a" } else { let n = 2
        title := "b" } }`);
    expect(await codes(siblings)).toEqual([]);
    expect(await codes(model('operation m() { let title = "x"\n this.title := title }'))).toEqual([]);
  });

  it("covers workflow and handler bodies", async () => {
    const src = `
system R { subdomain S { context C {
  aggregate Case with crudish { title: string  operation t(n: string) { title := n } }
  repository Cases for Case { }
  commandHandler H(c: Case id) { let k = Cases.get(c)
    let k = Cases.get(c)
    k.t("a") }
  workflow W { create(c: Case id) { let k = Cases.get(c)
    let c = 3
    k.t("b") } }
} } }`;
    expect(await codes(src)).toEqual(["loom.duplicate-let", "loom.duplicate-let"]);
  });
});

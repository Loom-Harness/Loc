// Gate for the text parse methods (ruling 175 on #5438): `s.toInt()` and its
// siblings type as `T or ParseError` through the built-in `LoomParse` service
// the macro layer splices into a context that parses, the built-in names are
// reserved, and the service's internal `unchecked*` conversions are refused in
// authored code.  What a parse ACCEPTS is behaviour, proven by the corpus
// fixture `text-parsing` on every backend; this file holds what only the
// validator can observe (diagnostics and the splice's trigger).

import { describe, expect, it } from "vitest";
import { parseString } from "../../_helpers/parse.js";

const wrap = (body: string, extra = ""): string => `
  context C {
    ${extra}
    aggregate Row {
      text: string
      note: string?
      n: int
      ${body}
    }
    repository Rows for Row { }
  }
`;
const diags = async (src: string, code: string) =>
  (await parseString(src)).diagnostics.filter((d) => d.code === code).map((d) => String(d.message));

const members = async (src: string): Promise<string[]> => {
  const { model } = await parseString(src);
  const ctx = model.members.find((m) => m.$type === "BoundedContext") as unknown as {
    members: { name?: string }[];
  };
  return ctx.members.map((m) => m.name ?? "");
};

describe("text parse methods", () => {
  it("type as `T or ParseError`, which must be matched", async () => {
    const doc = await parseString(
      wrap(`
        operation read(raw: string) {
          let r = raw.toInt()
          match r {
            int v => { n := v }
            ParseError e => { n := -1 }
          }
        }
      `),
    );
    expect(doc.diagnostics.filter((d) => d.severity === 1).map((d) => d.message)).toEqual([]);
  });

  it("refuse using the union as the value", async () => {
    const doc = await parseString(wrap(`operation read(raw: string) { n := raw.toInt() }`));
    expect(doc.diagnostics.filter((d) => d.severity === 1).length).toBeGreaterThan(0);
  });

  it("splice the built-in declarations only into a context that parses", async () => {
    const parsing = await members(wrap(`operation read(raw: string) { let r = raw.toDate() }`));
    expect(parsing).toEqual(
      expect.arrayContaining(["ParseTarget", "ParseFailure", "ParseError", "LoomParse"]),
    );
    const plain = await members(wrap(`operation read(raw: string) { n := raw.length }`));
    expect(plain).not.toContain("LoomParse");
    expect(plain).not.toContain("ParseError");
  });

  it("refuse a parse method called with arguments or bare (#call)", async () => {
    const [withArg] = await diags(
      wrap(`operation read(raw: string) { let r = raw.toInt(10) }`),
      "loom.intrinsic-parse",
    );
    expect(withArg).toContain("call it with no arguments");
  });

  it("refuse the internal conversions in authored code (#internal)", async () => {
    const [m] = await diags(
      wrap(`operation read(raw: string) { n := raw.uncheckedInt() }`),
      "loom.intrinsic-parse",
    );
    expect(m).toContain("internal to the built-in parse service");
  });

  it("do not offer the internal conversions as string members", async () => {
    const [m] = await diags(wrap(`derived d: string = text.nope()`), "loom.intrinsic-unknown");
    expect(m).not.toContain("unchecked");
  });

  for (const decl of [
    "error ParseError { input: string }",
    "enum ParseTarget { Int }",
    "enum ParseFailure { Empty }",
    "domainService LoomParse { operation f(): int { return 1 } }",
  ]) {
    it(`reserve the built-in name in \`${decl.split(" {")[0]}\``, async () => {
      const found = await diags(wrap("", decl), "loom.intrinsic-parse");
      expect(found).toHaveLength(1);
      expect(found[0]).toContain("is a built-in name");
    });
  }

  it("leave the spliced declarations themselves unflagged", async () => {
    expect(
      await diags(
        wrap(`operation read(raw: string) { let r = raw.toLong() }`),
        "loom.intrinsic-parse",
      ),
    ).toEqual([]);
  });
});

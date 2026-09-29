// Eval-closure item 6 / ruling D2: a `.ddd` member whose name is a reserved
// word in the TARGET language — or the name of a private helper the target's
// entity emitter generates — must still produce a project that compiles, with
// the wire key and the DB column unchanged.
//
// Python is the backend with no escape hatch (no verbatim identifier, and
// every `.ddd` member lands in an identifier position: a keyword argument, an
// attribute, a `def` name), so it gets ONE funnel (`pythonIdent` /
// `pythonWireIdent`, `def` → `def_`) plus the two outward names re-pinned: the
// DB column via `mapped_column("def", …)` and the wire key via a pydantic
// `alias`.  The helper-name collision (`assertInvariants`) hit three backends
// (.NET CS0102, TS duplicate class member, python's backing field overwriting
// its own method) and is resolved the same way on each: the helper steps
// aside ONLY when a member takes its name.
//
// The compile/behavioural proof is the `python-reserved-words` corpus row
// (every backend's compile tier + the wire-golden differential); these are the
// fast-tier pins on the emitted text, plus one TABLE test that takes its
// keyword list from the python interpreter itself rather than from our table.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  escapePythonIdent,
  pythonIdent,
  pythonWireIdent,
  pythonWireNeedsAlias,
} from "../../src/util/naming.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { parseString } from "../_helpers/parse.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = fs.readFileSync(
  path.join(here, "..", "fixtures", "corpus", "python-reserved-words.ddd"),
  "utf8",
);
const forPlatform = (p: string): string => FIXTURE.replaceAll("__PLATFORM__", p);

/** A python >= 3.12 interpreter (the generated project uses PEP 695 generic
 *  classes), or undefined when the host has none. */
function python312(): string | undefined {
  for (const bin of ["python3.13", "python3.12", "python3"]) {
    try {
      const v = execFileSync(bin, ["-c", "import sys; print(sys.version_info >= (3, 12))"], {
        encoding: "utf8",
      }).trim();
      if (v === "True") return bin;
    } catch {
      // not on PATH — try the next
    }
  }
  return undefined;
}
const PY = python312();

/** Byte-compile every emitted `.py` file; returns the failures. */
function pyCompileAll(files: Map<string, string>): string[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-py-reserved-"));
  try {
    const pys = [...files].filter(([p]) => p.endsWith(".py"));
    for (const [p, content] of pys) {
      const abs = path.join(dir, p);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
    const script = [
      "import ast, pathlib, sys",
      "bad = []",
      "for f in sorted(pathlib.Path(sys.argv[1]).rglob('*.py')):",
      "    try: ast.parse(f.read_text(), filename=str(f))",
      "    except SyntaxError as e: bad.append(f'{f.relative_to(sys.argv[1])}:{e.lineno}: {e.msg}')",
      "print('\\n'.join(bad))",
    ].join("\n");
    const out = execFileSync(PY!, ["-c", script, dir], { encoding: "utf8" }).trim();
    return out ? out.split("\n") : [];
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("python member-ident funnel (naming.ts)", () => {
  it("escapes a python keyword and leaves every other name alone", () => {
    expect(pythonIdent("def")).toBe("def_");
    expect(pythonIdent("class")).toBe("class_");
    expect(pythonIdent("assertInvariants")).toBe("assert_invariants");
    expect(pythonIdent("label")).toBe("label");
    // The wire spelling keeps camelCase; only a keyword moves (and then aliases).
    expect(pythonWireIdent("lambda")).toBe("lambda_");
    expect(pythonWireNeedsAlias("lambda")).toBe(true);
    expect(pythonWireIdent("assertInvariants")).toBe("assertInvariants");
    expect(pythonWireNeedsAlias("assertInvariants")).toBe(false);
  });

  it.skipIf(!PY)("covers every HARD keyword the python interpreter reports", () => {
    // Ground truth from the interpreter, not from our own table: a keyword the
    // table forgot is a syntax error in every generated project that uses it.
    const kw = JSON.parse(
      execFileSync(PY!, ["-c", "import json, keyword; print(json.dumps(keyword.kwlist))"], {
        encoding: "utf8",
      }),
    ) as string[];
    // `snake()` lowercases, so `True`/`False`/`None` can never reach the funnel
    // as themselves — their lowercase spellings are ordinary identifiers.
    const missed = kw.filter((k) => escapePythonIdent(k.toLowerCase()) === k.toLowerCase());
    expect(missed.filter((k) => k === k.toLowerCase())).toEqual([]);
  });
});

describe.skipIf(!PY)("python: every keyword Loom accepts as a name, in every member role", () => {
  it("the generated project parses", async () => {
    const kw = JSON.parse(
      execFileSync(PY!, ["-c", "import json, keyword; print(json.dumps(keyword.kwlist))"], {
        encoding: "utf8",
      }),
    ) as string[];
    // Loom reserves many of these itself (`if`, `return`, `and`, …); only the
    // ones it accepts as a member name can reach a backend at all.
    const accepted: string[] = [];
    for (const k of kw.filter((k) => k === k.toLowerCase())) {
      const { doc } = await parseString(
        `system P { subdomain S { context C { aggregate A { ${k}: int } } } }`,
      );
      if (doc.parseResult.parserErrors.length === 0) accepted.push(k);
    }
    expect(accepted.length).toBeGreaterThan(5);
    const src = `
      system KwTable {
        subdomain S {
          context C {
            valueobject V { ${accepted.map((k) => `${k}: int`).join("\n")} }
            aggregate A with crudish {
              ${accepted.map((k) => `${k}: int`).join("\n")}
              v: V
              function f(${accepted.map((k) => `${k}: int`).join(", ")}): int = this.${accepted[0]}
            }
            repository As for A {
              find byKw(${accepted[0]}: int): A[] where this.${accepted[0]} == ${accepted[0]}
            }
          }
        }
        storage pg { type: postgres }
        resource st { for: C, kind: state, use: pg }
        deployable d { platform: python contexts: [C] dataSources: [st] port: 3000 }
      }
    `;
    expect(pyCompileAll(await generateSystemFiles(src))).toEqual([]);
  });
});

describe("python: keyword member names (python-reserved-words)", async () => {
  const files = await generateSystemFiles(forPlatform("python"));
  const read = (p: string): string => {
    const hit = [...files].find(([k]) => k.endsWith(p));
    if (!hit) throw new Error(`no emitted file ending ${p}`);
    return hit[1];
  };

  it("the domain class escapes attributes, kwargs, methods and params", () => {
    const thing = read("app/domain/thing.py");
    expect(thing).toContain(
      "def __init__(self, *, id: ThingId, def_: str, lambda_: int, pass_: bool,",
    );
    expect(thing).toContain("    def def_(self) -> str:");
    expect(thing).toContain("    def raise_(self) -> int:");
    expect(thing).toContain("    def nonlocal_(self, del_: int) -> int:");
    expect(thing).toContain("        return del_ + self.lambda_");
    expect(thing).toContain("    def class_(self, except_: int) -> None:");
    expect(thing).toContain("        self._lambda = self.nonlocal_(except_)");
    // The backing field `_assert_invariants` belongs to the MEMBER now; the
    // helper stepped aside instead of being overwritten by it.
    expect(thing).toContain("        self._assert_invariants = assert_invariants");
    expect(thing).toContain("    def _assert_invariants_(self) -> None:");
    expect(thing).not.toMatch(/def _assert_invariants\(self/);
  });

  it("value objects and enums escape the identifier, keep the value", () => {
    const vos = read("app/domain/value_objects.py");
    expect(vos).toContain('    lambda_ = "lambda"');
    expect(vos).toContain("    yield_: int");
  });

  it("the row model keeps the DB column name", () => {
    const schema = read("app/db/schema.py");
    expect(schema).toContain('    def_: Mapped[str] = mapped_column("def", Text)');
    expect(schema).toContain('    lambda_: Mapped[int] = mapped_column("lambda", Integer)');
    // An unreserved column is byte-identical (no explicit SQL name).
    expect(schema).toContain("    label: Mapped[str] = mapped_column(Text)");
  });

  it("the pydantic wire models and the find route keep the wire key via alias", () => {
    const routes = read("app/http/thing_routes.py");
    expect(routes).toContain('    def_: str = Field(alias="def")');
    expect(routes).toContain('    def_: WireStr = Field(alias="def")');
    expect(routes).toContain('    lambda_: Int32 = Field(ge=0, alias="lambda")');
    expect(routes).toContain('    pass_: bool = Field(default=False, alias="pass")');
    expect(routes).toContain('def_: Annotated[WireStr, Query(alias="def")]');
    expect(routes).toContain("found.class_(body.except_)");
    expect(read("app/http/wire_models.py")).toContain('    yield_: Int32 = Field(alias="yield")');
  });

  it("the repository reads escaped attributes and writes declared keys", () => {
    const repo = read("app/db/repositories/thing_repository.py");
    expect(repo).toContain('"def": aggregate.def_,');
    expect(repo).toContain('"def": root.def_,');
    expect(repo).toContain('"span": {"yield": root.span.yield_, "label": root.span.label}');
    expect(repo).toContain("def_=row.def_,");
    // `?sort=def` resolves to the escaped ORM attribute.
    expect(repo).toContain('"def": "def_"');
  });

  it.skipIf(!PY)("every emitted python file parses", () => {
    expect(pyCompileAll(files)).toEqual([]);
  });
});

describe(".NET: a member named after the private invariant helper", async () => {
  const files = await generateSystemFiles(forPlatform("dotnet"));
  const thing = [...files].find(([k]) => k.endsWith("Domain/Things/Thing.cs"))![1];

  it("keeps the member's property and renames only the helper (was CS0102)", () => {
    expect(thing).toContain("    public string AssertInvariants { get; private set; }");
    expect(thing).toContain("    private void AssertInvariants_()");
    expect(thing).toContain("        AssertInvariants_();");
    expect(thing).not.toContain("private void AssertInvariants()");
  });
});

describe("node: keyword VO field + the private invariant helper", async () => {
  const files = await generateSystemFiles(forPlatform("node"));
  const read = (p: string): string => [...files].find(([k]) => k.endsWith(p))![1];

  it("binds a strict-mode reserved VO field under an escaped ctor param", () => {
    const vos = read("domain/value-objects.ts");
    expect(vos).toContain("    yield_: number,");
    expect(vos).toContain("    this.yield = yield_;");
    // The property itself keeps the declared (wire) name.
    expect(vos).toContain("  readonly yield: number;");
  });

  it("renames the helper only when a backing field takes its name", () => {
    const thing = read("domain/thing.ts");
    expect(thing).toContain("  private _assertInvariants: string;");
    expect(thing).toContain("  private _assertInvariants_(): void {");
  });
});

describe("byte-identity: a model with no reserved names keeps the old helper names", async () => {
  const plain = (p: string) => `
    system Plain {
      subdomain S {
        context C {
          aggregate Note with crudish {
            title: string
            invariant title != ""
          }
          repository Notes for Note { }
        }
      }
      storage pg { type: postgres }
      resource st { for: C, kind: state, use: pg }
      deployable d { platform: ${p} contexts: [C] dataSources: [st] port: 3000 }
    }
  `;
  it("python / .NET / node", async () => {
    const find = (m: Map<string, string>, suffix: string) =>
      [...m].find(([k]) => k.endsWith(suffix))![1];
    expect(find(await generateSystemFiles(plain("python")), "app/domain/note.py")).toContain(
      "    def _assert_invariants(self) -> None:",
    );
    expect(find(await generateSystemFiles(plain("dotnet")), "Domain/Notes/Note.cs")).toContain(
      "    private void AssertInvariants()",
    );
    expect(find(await generateSystemFiles(plain("node")), "domain/note.ts")).toContain(
      "  private _assertInvariants(): void {",
    );
  });

  it("the fixture parses clean on every backend clause", async () => {
    for (const p of ["node", "dotnet", "java", "python", "elixir"]) {
      const { doc } = await parseString(forPlatform(p));
      expect(doc.parseResult.parserErrors).toEqual([]);
    }
  });
});

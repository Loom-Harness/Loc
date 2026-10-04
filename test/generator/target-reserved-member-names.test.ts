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
import ts from "typescript";
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

// ---------------------------------------------------------------------------
// node (Hono) + the React frontend: a field / parameter named after a JS/TS
// reserved word.  Every TS BINDING position (method / function / ctor param,
// `const` local, repository-find param, criterion-fn param, workflow local)
// escapes through `escapeTsIdent` (`class` → `class_`); every PROPERTY
// position keeps the declared name (`this._class`, `get class()`, `{ class:
// … }`, `schema.things.class`, the zod wire key) — any string is a legal TS
// property.  Before the fix `public touch(class: string, …)` was a cascade of
// TS1390/TS1005 parse errors.  `enum`/`import`/`extends`/`static` are still
// Loom keywords, so they cannot reach the emitter from a parsed model; the
// names below are the reserved words Loom already accepts.
// ---------------------------------------------------------------------------

const TS_RESERVED_SRC = `
  system TsReserved {
    subdomain Core {
      context Things {
        valueobject Span {
          yield: int
          label: string
          function within(new: int, default: int): bool = new <= yield && default >= 0
        }

        criterion InClass(class: string) of Thing = this.class == class

        event Touched { class: string, new: int }

        aggregate Thing with crudish {
          class: string
          new: int
          default: bool
          interface: string
          yield: int
          span: Span
          derived protected: int = this.new + this.yield
          function delete(package: int, implements: int): int = package + implements + this.yield
          operation touch(class: string, new: int, default: bool, interface: string) {
            let public = Calc.sum(new, this.yield)
            this.class := class
            this.new := public
            this.default := default
            this.interface := interface
            emit Touched { class: class, new: new }
          }
          invariant new >= 0
        }

        repository Things for Thing {
          find byClass(class: string, new: int): Thing[] where this.class == class && this.new >= new
          find viaClass(class: string): Thing[] where InClass(class)
        }

        domainService Calc {
          operation sum(new: int, default: int): int {
            let class = new + default
            return class
          }
        }

        workflow MakeThing transactional {
          create(class: string, new: int) {
            precondition new >= 0
            let t = Thing.create({ class: class, new: new, default: true, interface: "i", yield: 2, span: Span { yield: 3, label: "x" } })
          }
        }
      }
    }

    api CoreApi from Core
    ui Web with scaffold(subdomains: [Core]) { }
    storage pg { type: postgres }
    resource thingState { for: Things, kind: state, use: pg }
    deployable api { platform: node contexts: [Things] dataSources: [thingState] serves: CoreApi port: 3000 }
    deployable web { platform: react targets: api ui: Web port: 3001 design: mantine }
  }
`;

/** TS GRAMMAR diagnostics (codes 1000–1999: parse errors, `'class' is not
 *  allowed as a parameter name`, strict-mode reserved words) across every
 *  emitted `.ts` / `.tsx` file.  Imports are left unresolved, so the 2xxx
 *  type errors that produces are filtered out — only a reserved-word / syntax
 *  break shows up here. */
function tsGrammarErrors(files: Map<string, string>): string[] {
  const sources = new Map(
    [...files]
      .filter(([p]) => /\.(ts|tsx)$/.test(p) && !p.endsWith(".d.ts"))
      .map(([p, c]) => [`/${p}`, c]),
  );
  const options: ts.CompilerOptions = {
    noEmit: true,
    noResolve: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    jsx: ts.JsxEmit.ReactJSX,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (name, lang) => {
    const text = sources.get(name);
    return text === undefined ? undefined : ts.createSourceFile(name, text, lang, true);
  };
  host.fileExists = (name) => sources.has(name);
  host.readFile = (name) => sources.get(name);
  const program = ts.createProgram([...sources.keys()], options, host);
  return [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()]
    .filter((d) => d.code < 2000 && d.file)
    .map((d) => {
      const { line } = d.file!.getLineAndCharacterOfPosition(d.start ?? 0);
      return `${d.file!.fileName}:${line + 1}: TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`;
    });
}

describe("node + react: JS/TS reserved words as field / parameter names", async () => {
  const files = await generateSystemFiles(TS_RESERVED_SRC);
  const read = (p: string): string => {
    const hit = [...files].find(([k]) => k.endsWith(p));
    if (!hit) throw new Error(`no emitted file ending ${p}`);
    return hit[1];
  };

  it("escapes operation / function params and locals, keeps the properties", () => {
    const thing = read("api/domain/thing.ts");
    expect(thing).toContain(
      "  public touch(class_: string, new_: number, default_: boolean, interface_: string): void {",
    );
    expect(thing).toContain("    const public_ = Calc.sum(new_, this.yield);");
    expect(thing).toContain("    this._class = class_;");
    expect(thing).toContain("    this._new = public_;");
    expect(thing).toContain(
      "  public delete(package_: number, implements_: number): number { return package_ + implements_ + this.yield; }",
    );
    // Property positions keep the declared name.
    expect(thing).toContain("  get class(): string { return this._class; }");
    expect(thing).toContain("  get protected(): number { return this.new + this.yield; }");
  });

  it("escapes value-object, domain-service and workflow bindings", () => {
    expect(read("api/domain/value-objects.ts")).toContain(
      "  within(new_: number, default_: number): boolean { return new_ <= this.yield && default_ >= 0; }",
    );
    const svc = read("api/domain/services.ts");
    expect(svc).toContain("export function sum(new_: number, default_: number): number {");
    expect(svc).toContain("const class_ = new_ + default_;");
    const wf = read("api/http/workflows.ts");
    expect(wf).toContain("const class_ = body.class;");
    expect(wf).toContain("Thing.create({ class: class_, new: new_,");
  });

  it("escapes repository-find + criterion params, keeps the column and wire keys", () => {
    const repo = read("api/db/repositories/thing-repository.ts");
    expect(repo).toContain(
      "const inClassCriterion = (class_: string) => eq(schema.things.class, class_);",
    );
    expect(repo).toContain("  async byClass(class_: string, new_: number): Promise<Thing[]> {");
    expect(repo).toContain("eq(schema.things.class, class_), gte(schema.things.new, new_)");
    expect(repo).toContain(".where(inClassCriterion(class_))");
    expect(read("api/domain/repository-ports.ts")).toContain(
      "  byClass(class_: string, new_: number): Promise<Thing[]>;",
    );
    // The wire (JSON) key is the declared spelling.
    expect(repo).toMatch(/\{ id: root\.id as string, class: root\.class, new: root\.new,/);
  });

  it("every emitted node + react TS file is free of TS grammar errors", () => {
    expect(tsGrammarErrors(files)).toEqual([]);
  });
});

describe("byte-identity: a model with no reserved names keeps its node bindings", () => {
  it("params and locals are unchanged", async () => {
    const files = await generateSystemFiles(`
      system Plain {
        subdomain S {
          context C {
            aggregate Note with crudish {
              title: string
              operation retitle(next: string) {
                let t = next
                this.title := t
              }
            }
            repository Notes for Note {
              find byTitle(title: string): Note[] where this.title == title
            }
          }
        }
        storage pg { type: postgres }
        resource st { for: C, kind: state, use: pg }
        deployable d { platform: node contexts: [C] dataSources: [st] port: 3000 }
      }
    `);
    const find = (suffix: string) => [...files].find(([k]) => k.endsWith(suffix))![1];
    expect(find("domain/note.ts")).toContain("  public retitle(next: string): void {");
    expect(find("domain/note.ts")).toContain("    const t = next;");
    expect(find("db/repositories/note-repository.ts")).toContain(
      "  async byTitle(title: string): Promise<Note[]> {",
    );
  });
});

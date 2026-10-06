// `<vo>.equals(other)` — VALUE equality, a value object's defining property —
// renders idiomatically on every backend (#3060 / #2864 follow-up).
//
// Before: the node emitter generates an `equals()` method on every VO class,
// so the call worked there and nowhere else.  In an op/function body the
// language rejected it outright (`'equals' is not a member of 'Berth'`); in a
// `test` body it reached the emitters verbatim — python rendered
// `d.berth.equals(Berth("A", 3))` against a frozen dataclass with no such
// attribute (mypy --strict: `"Berth" has no attribute "equals"`), and elixir's
// test emitter threw `UnsupportedTestShapeError: unsupported method-call
// 'equals'` at generate time.
//
// After: `equals` is a value-object intrinsic `(other: Self): bool` in the type
// system, and the lowerer turns the call into the SAME `binary ==` node a
// `vo == other` writes — so each backend's one value-equality leaf renders it.
// That exposed the mirror defect on node: VO `==` rendered `===`, reference
// identity, always false for two constructed values; it now routes through the
// emitted `equals()` too.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";
import { parseString } from "../_helpers/parse.js";

const BACKENDS = ["node", "python", "java", "dotnet", "elixir"] as const;
type Backend = (typeof BACKENDS)[number];

function systemFor(platform: Backend, extraVoMembers = ""): string {
  return `system Ports {
  subdomain Harbour {
    context Docking {
      valueobject Berth {
        pier: string
        position: int
        ${extraVoMembers}
      }
      aggregate Dock with crudish {
        name: string
        berth: Berth
        function isAt(pier: string, position: int): bool = berth.equals(Berth { pier: pier, position: position })
        function movedFrom(other: Berth): bool = !berth.equals(other)
        function sameAs(other: Berth): bool = berth == other
      }
      repository Docks for Dock { }
      test "value objects compare by value" {
        let a = Berth { pier: "A", position: 3 }
        expect(a.equals(Berth { pier: "A", position: 3 })).toBe(true)
        expect(a.equals(Berth { pier: "B", position: 3 })).toBe(false)
      }
    }
  }
  api DockingApi from Harbour
  storage primary { type: postgres }
  resource dockingState { for: Docking, kind: state, use: primary }
  deployable d {
    platform: ${platform}
    contexts: [Docking]
    dataSources: [dockingState]
    serves: DockingApi
    port: 4000
  }
}`;
}

function fileEndingWith(files: Map<string, string>, suffix: string): string {
  const hit = [...files].find(([p]) => p.endsWith(suffix));
  expect(hit, `no emitted file ends with ${suffix} — the probe is stale`).toBeDefined();
  return hit![1];
}

function filesMatching(files: Map<string, string>, re: RegExp): string {
  return [...files]
    .filter(([p]) => re.test(p))
    .map(([, s]) => s)
    .join("\n");
}

describe("<vo>.equals(other) renders value equality on every backend", () => {
  it("node: the domain function and the test both call the emitted equals()", async () => {
    const files = await generateSystemFiles(systemFor("node"));
    const dock = fileEndingWith(files, "domain/dock.ts");
    expect(dock).toContain("return (this._berth.equals(new Berth(pier, position)));");
    expect(dock).toContain("return !(this._berth.equals(other));");
    // The mirror defect: `==` on a value object was `===` (reference identity).
    expect(dock).toContain("return this._berth.equals(other);");
    expect(dock).not.toContain("this._berth === ");
    const tests = filesMatching(files, /\.test\.ts$/);
    expect(tests).toContain('a.equals(new Berth("A", 3))');
  });

  it("python: renders `==` (frozen-dataclass __eq__), never a `.equals` attribute", async () => {
    const files = await generateSystemFiles(systemFor("python"));
    const dock = fileEndingWith(files, "app/domain/dock.py");
    expect(dock).toContain("return (self._berth == Berth(pier, position))");
    expect(dock).toContain("return not (self._berth == other)");
    const tests = filesMatching(files, /tests\/.*\.py$/);
    expect(tests).toContain('(a == Berth("A", 3))');
    expect(filesMatching(files, /\.py$/)).not.toMatch(/\.equals\(/);
  });

  it("java: renders Objects.equals (record equality)", async () => {
    const files = await generateSystemFiles(systemFor("java"));
    const dock = fileEndingWith(files, "features/docks/Dock.java");
    expect(dock).toContain("return (Objects.equals(this.berth, new Berth(pier, position)));");
    expect(dock).toContain("return !(Objects.equals(this.berth, other));");
    const tests = filesMatching(files, /src\/test\/.*\.java$/);
    expect(tests).toContain('Objects.equals(a, new Berth("A", 3))');
    expect(tests).toContain("import java.util.Objects;");
  });

  it("dotnet: renders record `==`", async () => {
    const files = await generateSystemFiles(systemFor("dotnet"));
    const dock = fileEndingWith(files, "Domain/Docks/Dock.cs");
    expect(dock).toContain("=> (this.Berth == new Berth(pier, position));");
    // The precedence guard: bare, this was `!this.Berth == other` — CS0023.
    expect(dock).toContain("=> !(this.Berth == other);");
    const tests = filesMatching(files, /Tests\/.*\.cs$/);
    expect(tests).toContain('(a == new Berth("A", 3))');
  });

  it("elixir: renders `==` and the test emitter no longer throws", async () => {
    const files = await generateSystemFiles(systemFor("elixir"));
    const ctx = fileEndingWith(files, "lib/d/docking.ex");
    expect(ctx).toContain("(record.berth == %{pier: pier, position: position})");
    // The precedence guard: bare, `not record.berth == other` negates the MAP
    // (`not` binds tighter than `==`) and raises ArgumentError at runtime.
    expect(ctx).toContain("not (record.berth == other)");
    const tests = filesMatching(files, /test\/.*\.exs$/);
    expect(tests).toContain('a == %{pier: "A", position: 3}');
    expect(tests).not.toMatch(/\.equals\(/);
  });

  it("a value object that declares its OWN `equals` keeps the ordinary call", async () => {
    const files = await generateSystemFiles(
      systemFor("python", "function equals(other: Berth): bool = pier == other.pier"),
    );
    const dock = fileEndingWith(files, "app/domain/dock.py");
    expect(dock).toContain("self._berth.equals(Berth(pier, position))");
  });
});

describe("<vo>.equals call shape is validated like a scalar intrinsic", () => {
  async function errorsFor(call: string): Promise<string[]> {
    const src = systemFor("node").replace(
      "berth.equals(Berth { pier: pier, position: position })",
      call,
    );
    const { diagnostics } = await parseString(src);
    return diagnostics
      .filter((d) => d.severity === 1)
      .map((d) => String((d as { code?: unknown }).code));
  }

  it("accepts one argument of the same value object", async () => {
    expect(await errorsFor("berth.equals(Berth { pier: pier, position: position })")).toEqual([]);
  });

  it("rejects an argument of another type", async () => {
    expect(await errorsFor("berth.equals(pier)")).toContain("loom.intrinsic-arg-type");
  });

  it("rejects the wrong arity", async () => {
    expect(await errorsFor("berth.equals()")).toContain("loom.intrinsic-arity");
  });

  it("rejects the bare member form", async () => {
    expect(await errorsFor("berth.equals")).toContain("loom.intrinsic-bare");
  });

  it("still rejects a genuinely absent member", async () => {
    expect(await errorsFor("berth.sameAs(berth)")).toContain("loom.unknown-member");
  });
});

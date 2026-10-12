// ---------------------------------------------------------------------------
// M-T9.43 — render every `VALUE_ROWS` row through each backend's REAL
// expression renderer, EXECUTE it in that backend's own language, and compare
// the VALUE (see `expr-value-table.ts` for why).
//
// One process per backend, not one per row: each harness writes a single
// program holding one function per row, runs it once, and reads back one
// `id \t type \t raw` line per row.  Canonicalisation happens here, on one side,
// so the five languages only have to print what they computed.
//
// Toolchains.  node evaluates in-process but needs `decimal.js` (the library
// every generated node app ships), which the ROOT package does not depend on —
// it is resolved from the behavioural harness's install (`test/behavioral`).
// python needs `python3` (stdlib only: the helper module is the EMITTED
// `app/domain/numeric.py`, not a re-implementation).  java needs a JDK ≥ 11
// (single-file source launch).  dotnet needs an SDK ≥ 10 (file-based `dotnet
// run`) and is slow on a cold cache.
//
// A missing toolchain SKIPS that backend with its reason printed — unless the
// backend is named in `LOOM_EXPR_VALUES_REQUIRE` (comma list, or `all`), in
// which case its absence FAILS.  That is the vacuity guard: a CI leg that
// requires a backend can never go green by not running it.  Independently,
// every backend that does run must answer EVERY row (a harness that drops a
// row fails, rather than comparing the rows it happened to print).
// ---------------------------------------------------------------------------

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderCsExpr } from "../../../src/generator/dotnet/render-expr.js";
import { collectJavaExprImports, renderJavaExpr } from "../../../src/generator/java/render-expr.js";
import { NUMERIC_PY } from "../../../src/generator/python/emit/numeric.js";
import { renderPyExpr } from "../../../src/generator/python/render-expr.js";
import { renderTsExpr } from "../../../src/generator/typescript/render-expr.js";
import {
  type Expected,
  VALUE_ROWS,
  type ValueBackend,
  type ValueRow,
  type ValueType,
} from "./expr-value-table.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

type Backend = ValueBackend;

// On CI the fast suite REQUIRES python and java: both ship on the GitHub
// ubuntu runner image, and the string arms those two backends used to carry
// were deleted in favour of these rows (M-T9.43) — so a CI job that silently
// skipped them would have no gate on those arms at all.  node needs the
// behavioural package's `decimal.js` and dotnet a cold ~20s build, so both stay
// opt-in (their string arms are kept).
const REQUIRED = new Set([
  ...(process.env.CI ? ["python", "java"] : []),
  ...(process.env.LOOM_EXPR_VALUES_REQUIRE ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean),
]);
const required = (b: Backend): boolean => REQUIRED.has(b) || REQUIRED.has("all");

/** One printed result, before canonicalisation. */
interface Raw {
  readonly type: string;
  readonly raw: string;
}

/** A canonical decimal: plain notation, no trailing fractional zeros, no `-0`. */
function canonDecimal(text: string): string {
  const t = text.trim();
  if (!/^-?\d+(\.\d+)?$/.test(t)) return `<not-a-plain-decimal:${t}>`;
  let [intPart, frac = ""] = t.split(".");
  frac = frac.replace(/0+$/, "");
  const neg = intPart!.startsWith("-");
  const digits = intPart!.replace("-", "").replace(/^0+(?=\d)/, "");
  const out = frac ? `${digits}.${frac}` : digits;
  return neg && out !== "0" ? `-${out}` : out;
}

function canon(r: Raw, expected: Expected): string {
  switch (r.type) {
    case "num":
      return expected.kind === "int" ? r.raw.trim() : canonDecimal(r.raw);
    case "str":
      return JSON.stringify(JSON.parse(r.raw));
    case "bool":
      return r.raw.trim().toLowerCase();
    case "list":
      return `[${(JSON.parse(r.raw) as string[]).map((x) => canonDecimal(String(x))).join(",")}]`;
    default:
      return `<${r.type}: ${r.raw}>`;
  }
}

function parseLines(stdout: string): Map<string, Raw> {
  const out = new Map<string, Raw>();
  for (const line of stdout.split("\n")) {
    const [id, type, ...rest] = line.split("\t");
    if (!id || !type) continue;
    out.set(id, { type, raw: rest.join("\t") });
  }
  return out;
}

const decodeStr = (json: string): string => JSON.parse(json) as string;

// ── node (in-process) ───────────────────────────────────────────────────────

function nodeDecimal(): { Decimal: unknown } | string {
  const pkg = join(REPO, "test", "behavioral", "package.json");
  try {
    const req = createRequire(pkg);
    const mod = req("decimal.js") as { default?: unknown };
    return { Decimal: mod.default ?? mod };
  } catch {
    return "decimal.js is not resolvable from test/behavioral (run `npm ci` there)";
  }
}

function nodeInput(type: ValueType, value: string): string {
  switch (type) {
    // A `decimal` is a native JS number on node (`renderTsType`), a `money` a
    // decimal.js Decimal — bind each as the generated app holds it.
    case "money":
      return `new Decimal(${JSON.stringify(value)})`;
    case "money[]":
      return `[${value
        .slice(1, -1)
        .split(",")
        .map((x) => `new Decimal(${JSON.stringify(x)})`)
        .join(", ")}]`;
    default:
      return value;
  }
}

function runNode(rows: readonly ValueRow[], Decimal: unknown): Map<string, Raw> {
  const out = new Map<string, Raw>();
  for (const row of rows) {
    const names = Object.keys(row.params);
    const code = renderTsExpr(row.expr);
    try {
      const fn = new Function("Decimal", ...names, `return (${code});`);
      const args = names.map((k) => {
        const prm = row.params[k]!;
        return new Function("Decimal", `return (${nodeInput(prm.type, prm.value)});`)(Decimal);
      });
      const v: unknown = fn(Decimal, ...args);
      if (typeof v === "string") out.set(row.id, { type: "str", raw: JSON.stringify(v) });
      else if (typeof v === "boolean") out.set(row.id, { type: "bool", raw: String(v) });
      else if (typeof v === "number") out.set(row.id, { type: "num", raw: String(v) });
      else if (Array.isArray(v))
        out.set(row.id, { type: "list", raw: JSON.stringify(v.map(String)) });
      else if (v && typeof (v as { toFixed?: unknown }).toFixed === "function")
        out.set(row.id, { type: "num", raw: (v as { toFixed(): string }).toFixed() });
      else out.set(row.id, { type: "other", raw: String(v) });
    } catch (e) {
      out.set(row.id, { type: "err", raw: `${(e as Error).message} :: ${code}` });
    }
  }
  return out;
}

// ── python (one python3 process) ────────────────────────────────────────────

function pyInput(type: ValueType, value: string): string {
  switch (type) {
    case "bool":
      return value === "true" ? "True" : "False";
    // `decimal` is a Python float (`renderPyType`), `money` a Decimal.
    case "decimal":
      return `float(${JSON.stringify(value)})`;
    case "money":
      return `Decimal(${JSON.stringify(value)})`;
    case "money[]":
      return `[${value
        .slice(1, -1)
        .split(",")
        .map((x) => `Decimal(${JSON.stringify(x)})`)
        .join(", ")}]`;
    case "string":
      return `json.loads(${JSON.stringify(value)})`;
    default:
      return value;
  }
}

function pyProgram(rows: readonly ValueRow[]): string {
  const fns = rows.map((row) => {
    const names = Object.keys(row.params);
    return `def r_${row.id}(${names.join(", ")}):\n    return ${renderPyExpr(row.expr)}\n`;
  });
  const calls = rows.map((row) => {
    const args = Object.values(row.params).map((prm) => pyInput(prm.type, prm.value));
    return `_emit(${JSON.stringify(row.id)}, lambda: r_${row.id}(${args.join(", ")}))`;
  });
  return [
    NUMERIC_PY,
    "import json",
    "from decimal import Decimal",
    "",
    "def _show(v):",
    "    if isinstance(v, bool): return 'bool', 'true' if v else 'false'",
    "    if isinstance(v, Decimal): return 'num', format(v, 'f')",
    "    if isinstance(v, (int, float)): return 'num', repr(v)",
    "    if isinstance(v, str): return 'str', json.dumps(v)",
    "    if isinstance(v, list): return 'list', json.dumps([_show(x)[1] for x in v])",
    "    return 'other', repr(v)",
    "",
    "def _emit(rid, thunk):",
    "    try:",
    "        t, raw = _show(thunk())",
    "    except Exception as e:",
    "        t, raw = 'err', repr(e)",
    "    print(rid + '\\t' + t + '\\t' + raw)",
    "",
    ...fns,
    ...calls,
    "",
  ].join("\n");
}

// ── java (one single-file source launch) ────────────────────────────────────

const JAVA_TYPE: Record<ValueType, string> = {
  int: "int",
  // Both `decimal` and `money` are BigDecimal in the java domain (`renderJavaType`).
  decimal: "java.math.BigDecimal",
  money: "java.math.BigDecimal",
  string: "String",
  bool: "boolean",
  "int[]": "java.util.List<Integer>",
  "money[]": "java.util.List<java.math.BigDecimal>",
};

function javaInput(type: ValueType, value: string): string {
  switch (type) {
    case "money":
    case "decimal":
      return `new java.math.BigDecimal(${JSON.stringify(value)})`;
    case "int[]":
      return `java.util.List.of(${value.slice(1, -1)})`;
    case "money[]":
      return `java.util.List.of(${value
        .slice(1, -1)
        .split(",")
        .map((x) => `new java.math.BigDecimal(${JSON.stringify(x)})`)
        .join(", ")})`;
    case "string":
      return JSON.stringify(decodeStr(value)).replace(
        /[\u007f-\uffff]/g,
        (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
      );
    default:
      return value;
  }
}

function javaProgram(rows: readonly ValueRow[]): string {
  const fns = rows.map((row) => {
    const sig = Object.entries(row.params)
      .map(([k, prm]) => `${JAVA_TYPE[prm.type]} ${k}`)
      .join(", ");
    return `  static Object r_${row.id}(${sig}) {\n    return ${renderJavaExpr(row.expr)};\n  }`;
  });
  const calls = rows.map((row) => {
    const args = Object.values(row.params).map((prm) => javaInput(prm.type, prm.value));
    return `    emit(${JSON.stringify(row.id)}, () -> r_${row.id}(${args.join(", ")}));`;
  });
  // The imports come from the renderer's OWN collector — the set a generated
  // file would carry — so a rendering that names a symbol its collector does
  // not import fails here the way it fails `gradle compileJava`.
  const imports = new Set<string>();
  for (const row of rows) collectJavaExprImports(row.expr, imports);
  return [
    ...[...imports].sort().map((i) => `import ${i};`),
    "import java.math.BigDecimal;",
    "import java.util.*;",
    "import java.util.function.Supplier;",
    "import java.util.stream.*;",
    "",
    "public class Main {",
    ...fns,
    "  static String json(String s) {",
    '    StringBuilder b = new StringBuilder("\\"");',
    "    for (char c : s.toCharArray()) {",
    "      if (c == '\"' || c == '\\\\') b.append('\\\\').append(c);",
    '      else if (c < 0x20 || c > 0x7e) b.append(String.format("\\\\u%04x", (int) c));',
    "      else b.append(c);",
    "    }",
    "    return b.append('\"').toString();",
    "  }",
    "  static String show(Object v) {",
    '    if (v instanceof Boolean x) return "bool\\t" + x;',
    '    if (v instanceof BigDecimal x) return "num\\t" + x.toPlainString();',
    '    if (v instanceof Double x) return "num\\t" + new BigDecimal(Double.toString(x)).toPlainString();',
    '    if (v instanceof Number x) return "num\\t" + x;',
    '    if (v instanceof String x) return "str\\t" + json(x);',
    '    if (v instanceof List<?> x) return "list\\t[" + x.stream().map(e -> json(show(e).split("\\t", 2)[1])).collect(Collectors.joining(",")) + "]";',
    '    return "other\\t" + v;',
    "  }",
    "  static void emit(String id, Supplier<Object> f) {",
    "    String line;",
    '    try { line = show(f.get()); } catch (Throwable e) { line = "err\\t" + e; }',
    '    System.out.println(id + "\\t" + line);',
    "  }",
    "  public static void main(String[] argv) {",
    ...calls,
    "  }",
    "}",
    "",
  ].join("\n");
}

// ── dotnet (one file-based `dotnet run`) ────────────────────────────────────

const CS_TYPE: Record<ValueType, string> = {
  int: "int",
  // Both are System.Decimal in the .NET domain (`renderCsType`).
  decimal: "decimal",
  money: "decimal",
  string: "string",
  bool: "bool",
  "int[]": "System.Collections.Generic.List<int>",
  "money[]": "System.Collections.Generic.List<decimal>",
};

function csInput(type: ValueType, value: string): string {
  switch (type) {
    case "money":
    case "decimal":
      return `${value}m`;
    case "int[]":
      return `new System.Collections.Generic.List<int> { ${value.slice(1, -1)} }`;
    case "money[]":
      return `new System.Collections.Generic.List<decimal> { ${value
        .slice(1, -1)
        .split(",")
        .map((x) => `${x}m`)
        .join(", ")} }`;
    case "string":
      return JSON.stringify(decodeStr(value)).replace(
        /[\u007f-\uffff]/g,
        (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
      );
    default:
      return value;
  }
}

function csProgram(rows: readonly ValueRow[]): string {
  const fns = rows.map((row) => {
    const sig = Object.entries(row.params)
      .map(([k, prm]) => `${CS_TYPE[prm.type]} ${k}`)
      .join(", ");
    return `static object R_${row.id}(${sig}) => ${renderCsExpr(row.expr)};`;
  });
  const calls = rows.map((row) => {
    const args = Object.values(row.params).map((prm) => csInput(prm.type, prm.value));
    return `Emit(${JSON.stringify(row.id)}, () => R_${row.id}(${args.join(", ")}));`;
  });
  return [
    "using System;",
    "using System.Linq;",
    "using System.Collections.Generic;",
    "using System.Globalization;",
    ...calls,
    "static string Show(object v) => v switch {",
    '  bool x => "bool\\t" + (x ? "true" : "false"),',
    '  decimal x => "num\\t" + x.ToString(CultureInfo.InvariantCulture),',
    '  double x => "num\\t" + ((decimal)x).ToString(CultureInfo.InvariantCulture),',
    '  int or long => "num\\t" + Convert.ToString(v, CultureInfo.InvariantCulture),',
    '  string x => "str\\t" + Json(x),',
    '  System.Collections.IEnumerable x => "list\\t[" + string.Join(",", x.Cast<object>().Select(e => Json(Show(e).Split(\'\\t\', 2)[1]))) + "]",',
    '  _ => "other\\t" + v,',
    "};",
    // Hand-rolled: a file-based app runs trimmed, so reflection JSON is off.
    String.raw`static string Json(string s) {
  var b = new System.Text.StringBuilder("\"");
  foreach (var c in s) {
    if (c == '"' || c == '\\') b.Append('\\').Append(c);
    else if (c < 0x20 || c > 0x7e) b.Append("\\u").Append(((int)c).ToString("x4"));
    else b.Append(c);
  }
  return b.Append('"').ToString();
}`,
    "static void Emit(string id, Func<object> f) {",
    "  string line;",
    '  try { line = Show(f()); } catch (Exception e) { line = "err\\t" + e.GetType().Name + ": " + e.Message; }',
    '  Console.WriteLine(id + "\\t" + line);',
    "}",
    ...fns,
    "",
  ].join("\n");
}

// ── process plumbing ────────────────────────────────────────────────────────

function which(cmd: string, extra: string[] = []): string | null {
  for (const dir of [...(process.env.PATH ?? "").split(":"), ...extra]) {
    const p = join(dir, cmd);
    if (dir && existsSync(p)) return p;
  }
  return null;
}

let WORK = "";

function runProcess(
  bin: string,
  args: string[],
  file: string,
  program: string,
  timeoutMs: number,
): Map<string, Raw> | string {
  writeFileSync(file, program);
  const r = spawnSync(bin, args, {
    cwd: dirname(file),
    encoding: "utf8",
    timeout: timeoutMs,
    env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: "1", DOTNET_NOLOGO: "1" },
  });
  if (r.status !== 0) {
    return `${bin} exited ${r.status ?? r.signal}:\n${`${r.stdout ?? ""}\n${r.stderr ?? ""}`.slice(0, 6000)}`;
  }
  return parseLines(r.stdout);
}

interface BackendRun {
  readonly results?: Map<string, Raw>;
  readonly skipped?: string;
  readonly failed?: string;
}

const RUNS = new Map<Backend, BackendRun>();

beforeAll(() => {
  WORK = mkdtempSync(join(tmpdir(), "loom-expr-values-"));

  const dec = nodeDecimal();
  RUNS.set(
    node(),
    typeof dec === "string" ? { skipped: dec } : { results: runNode(VALUE_ROWS, dec.Decimal) },
  );

  const py = which("python3");
  if (!py) RUNS.set("python", { skipped: "python3 is not on PATH" });
  else {
    const r = runProcess(py, ["values.py"], join(WORK, "values.py"), pyProgram(VALUE_ROWS), 60_000);
    RUNS.set("python", typeof r === "string" ? { failed: r } : { results: r });
  }

  const java = which("java");
  if (!java) RUNS.set("java", { skipped: "java is not on PATH" });
  else {
    const dir = join(WORK, "java");
    mkdirSync(dir);
    const r = runProcess(
      java,
      ["Main.java"],
      join(dir, "Main.java"),
      javaProgram(VALUE_ROWS),
      120_000,
    );
    RUNS.set("java", typeof r === "string" ? { failed: r } : { results: r });
  }

  const dotnet = which("dotnet", ["/opt/dotnet"]);
  if (!dotnet) RUNS.set("dotnet", { skipped: "dotnet is not on PATH (nor /opt/dotnet)" });
  else if (!required("dotnet") && process.env.LOOM_EXPR_VALUES_DOTNET !== "1")
    RUNS.set("dotnet", {
      skipped:
        "dotnet runs only when required or LOOM_EXPR_VALUES_DOTNET=1 (a cold file-based build is ~20s)",
    });
  else {
    const dir = join(WORK, "cs");
    mkdirSync(dir);
    const r = runProcess(
      dotnet,
      ["run", "values.cs"],
      join(dir, "values.cs"),
      csProgram(VALUE_ROWS),
      300_000,
    );
    RUNS.set("dotnet", typeof r === "string" ? { failed: r } : { results: r });
  }
}, 420_000);

afterAll(() => {
  if (WORK) rmSync(WORK, { recursive: true, force: true });
});

// Keeps the "node" literal typed as a Backend at the one call site above.
function node(): Backend {
  return "node";
}

const BACKENDS: readonly Backend[] = ["node", "python", "java", "dotnet"];

describe("expression VALUE table — the rows themselves", () => {
  it("every row id is a valid identifier in all four target languages, and unique", () => {
    const ids = VALUE_ROWS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it("covers the arms the mission names — `&&`, integer division, money arithmetic", () => {
    const arms = VALUE_ROWS.map((r) => r.arm).join(" | ");
    expect(arms).toContain("binary &&");
    expect(arms).toContain("int.divTrunc");
    expect(arms).toContain("binary + (money)");
  });
});

for (const backend of BACKENDS) {
  describe(`expression VALUE table — ${backend}`, () => {
    it("ran, or is not required and says why it did not", () => {
      const run = RUNS.get(backend);
      expect(run, `no run recorded for ${backend}`).toBeDefined();
      if (run?.failed) throw new Error(`${backend} harness failed:\n${run.failed}`);
      if (run?.skipped) {
        if (required(backend))
          throw new Error(`${backend} is REQUIRED but skipped: ${run.skipped}`);
        console.warn(`[expr-value] ${backend} skipped — ${run.skipped}`);
      }
    });

    it("answered EVERY row (no row silently missing from the harness output)", () => {
      const run = RUNS.get(backend);
      if (!run?.results) return;
      const missing = VALUE_ROWS.filter((r) => !run.results?.has(r.id)).map((r) => r.id);
      expect(missing).toEqual([]);
    });

    for (const row of VALUE_ROWS) {
      it(`${row.id} — ${row.arm}`, () => {
        const run = RUNS.get(backend);
        if (!run?.results) return;
        const raw = run.results.get(row.id);
        expect(raw, `${row.id} missing`).toBeDefined();
        const named = row.divergesOn?.[backend];
        const want = named?.value ?? row.expected.value;
        expect(
          canon(raw!, row.expected),
          `${backend} ${row.id}: ${named ? `NAMED divergence — ${named.reason}` : row.why}`,
        ).toBe(row.expected.kind === "string" ? JSON.stringify(JSON.parse(want)) : want);
      });
    }
  });
}

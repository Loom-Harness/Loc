// ---------------------------------------------------------------------------
// Cross-target STRING-UNIT property gate: every frontend expression target
// counts string positions in CODE POINTS, as every backend does
// (`src/generator/_expr/code-point.ts`).
//
// The host primitives all count UTF-16 units — JS `s.length`, .NET
// `String.Length` under Fable, Dart `String.length` — so a target that
// renders `.length` / `substring` / `padStart` / `padEnd` through its host's
// own member reads `"a😀bc"` as 5 units and shifts every offset past the emoji,
// while the server it talks to reads 4.  Nothing a compiler reports.
//
// What this proves, per target, IN PROCESS:
//   - the JS-embedding targets (React / Vue / Svelte / Angular): the rendered
//     JS is evaluated on the probe and must give the code-point answers;
//   - Feliz: the rendered F# must be a Fable `emitJsExpr` whose JS template,
//     with its arguments spliced in, is evaluated the same way — the JS Fable
//     compiles it to;
//   - Flutter: Dart cannot run here, so the target is held to the shared Dart
//     code-point helpers (`dartCodePoint*`); what those DO is asserted by the
//     `string-units-ui-flutter` behavioural case (`test/behavioral/
//     string-units-ui.ddd`), which every target also runs.
//
// The target list is DISCOVERED from the source (every exported
// `: WalkerTarget =` declaration), so a new frontend target fails here until
// it is given an evaluator below — it cannot ship host-unit string ops
// unnoticed.  `exprStringLength` is a required seam, so it cannot ship
// without one either.
// ---------------------------------------------------------------------------

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CODE_POINT_INTRINSICS,
  dartCodePointLength,
  dartCodePointPad,
  dartCodePointSubstring,
} from "../../../src/generator/_expr/code-point.js";
import type { WalkerTarget } from "../../../src/generator/_walker/target.js";
import { angularTarget } from "../../../src/generator/angular/walker/angular-target.js";
import { heexTarget } from "../../../src/generator/elixir/heex-target.js";
import { felizTarget } from "../../../src/generator/feliz/feliz-target.js";
import {
  flutterComponentTarget,
  flutterTarget,
} from "../../../src/generator/flutter/flutter-target.js";
import { tsxTarget } from "../../../src/generator/react/walker/tsx-target.js";
import { svelteTarget } from "../../../src/generator/svelte/walker/svelte-target.js";
import { vueTarget } from "../../../src/generator/vue/walker/vue-target.js";
import type { TypeIR } from "../../../src/ir/types/loom-ir.js";
import { INTRINSIC_SIGNATURES, intrinsicKey } from "../../../src/util/intrinsics.js";

const STRING: TypeIR = { kind: "primitive", name: "string" };

/** `"a😀bc"`: 4 code points, 5 UTF-16 units. */
const PROBE = "a😀bc";

/** One op over the probe, rendered with the receiver spelled `s` and the
 *  arguments as source-literal JS (a JS literal is the same text in every
 *  target language used here), with its code-point answer. */
interface Row {
  op: string;
  args: string[];
  expected: string | number;
}
const ROWS: readonly Row[] = [
  { op: "string.substring", args: ["1", "2"], expected: "😀b" },
  { op: "string.substring", args: ["2"], expected: "bc" },
  { op: "string.substring", args: ["4"], expected: "" },
  { op: "string.substring", args: ["1", "9"], expected: "😀bc" },
  { op: "string.padStart", args: ["6", '"-"'], expected: "--a😀bc" },
  { op: "string.padEnd", args: ["6", '"-"'], expected: "a😀bc--" },
  { op: "string.padStart", args: ["7", '"xy"'], expected: "xyxa😀bc" },
];

const dartLit = (a: string) => a.replaceAll('"', "'");

/** Evaluate a rendered JS expression with `s` bound. */
function evalJs(code: string, s: unknown): unknown {
  return new Function("s", `return (${code});`)(s);
}

/** The JS Fable compiles a rendered `emitJsExpr` to, evaluated: the template
 *  with each `$n` replaced by its argument.  Undefined when the F# is not an
 *  `emitJsExpr` — i.e. it runs .NET string members, which count UTF-16 units. */
function evalFable(fs: string, s: unknown): unknown {
  const m = /^\(Fable\.Core\.JsInterop\.emitJsExpr \((.*)\) "((?:[^"\\]|\\.)*)" : \w+\)$/.exec(fs);
  if (!m) return undefined;
  const args = m[1]!.split(", ");
  const template = m[2]!.replaceAll('\\"', '"').replaceAll("\\\\", "\\");
  const js = template.replace(/\$(\d+)/g, (_, i: string) => args[Number(i)]!);
  return evalJs(js, s);
}

type Check = (target: WalkerTarget) => void;

const jsCheck: Check = (target) => {
  expect(evalJs(target.exprStringLength("s"), PROBE), ".length on a string").toBe(4);
  expect(evalJs(target.exprStringLength("s"), ["a", "b", "c"]), ".length on a list").toBe(3);
  for (const row of ROWS) {
    const [, name] = row.op.split(".");
    const code = target.renderIntrinsic?.(STRING, name!, "s", row.args);
    expect(code, `${row.op} has no arm`).toBeDefined();
    expect(evalJs(code!, PROBE), `${row.op}(${row.args.join(", ")})`).toBe(row.expected);
  }
};

const felizCheck: Check = (target) => {
  expect(evalFable(target.exprStringLength("s"), PROBE), ".length on a string").toBe(4);
  // A JS spread iterates Fable's `FSharpList` too; an array stands in for it.
  expect(evalFable(target.exprStringLength("s"), ["a", "b", "c"]), ".length on a list").toBe(3);
  for (const row of ROWS) {
    const [, name] = row.op.split(".");
    const fs = target.renderIntrinsic?.(STRING, name!, "s", row.args) ?? "";
    expect(evalFable(fs, PROBE), `${row.op}(${row.args.join(", ")}) → ${fs}`).toBe(row.expected);
  }
};

const dartCheck: Check = (target) => {
  expect(target.exprStringLength("s")).toBe(dartCodePointLength("s"));
  for (const row of ROWS) {
    const [, name] = row.op.split(".");
    const args = row.args.map(dartLit);
    const expected =
      row.op === "string.substring"
        ? dartCodePointSubstring("s", args[0]!, args[1])
        : dartCodePointPad("s", args[0]!, args[1]!, row.op === "string.padStart");
    expect(target.renderIntrinsic?.(STRING, name!, "s", args), row.op).toBe(expected);
  }
};

/** Every `WalkerTarget`, by its exported name, with how it is held to the
 *  code-point answers.  `heexTarget` renders every expression as Elixir
 *  through its own renderer (`renderExprOverride`), never through these seams. */
const TARGETS: Record<string, { target: WalkerTarget; check: Check | "elixir-override" }> = {
  tsxTarget: { target: tsxTarget, check: jsCheck },
  vueTarget: { target: vueTarget, check: jsCheck },
  svelteTarget: { target: svelteTarget, check: jsCheck },
  angularTarget: { target: angularTarget, check: jsCheck },
  felizTarget: { target: felizTarget, check: felizCheck },
  flutterTarget: { target: flutterTarget, check: dartCheck },
  flutterComponentTarget: { target: flutterComponentTarget, check: dartCheck },
  heexTarget: { target: heexTarget, check: "elixir-override" },
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? sourceFiles(p) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("frontend string ops count code points on every target", () => {
  it("every WalkerTarget in the source is held to the probe", () => {
    const declared = sourceFiles("src/generator").flatMap((f) =>
      [...readFileSync(f, "utf8").matchAll(/export const (\w+): WalkerTarget = /g)].map(
        (m) => m[1]!,
      ),
    );
    expect(declared.length).toBeGreaterThan(0);
    expect([...declared].sort()).toEqual(Object.keys(TARGETS).sort());
  });

  it("the code-point ops are the catalogue's string-position intrinsics", () => {
    const keys = new Set(INTRINSIC_SIGNATURES.map((s) => intrinsicKey(s.receiver, s.name)));
    for (const op of CODE_POINT_INTRINSICS) expect(keys.has(op), op).toBe(true);
    expect(new Set(ROWS.map((r) => r.op))).toEqual(CODE_POINT_INTRINSICS);
  });

  for (const [name, { target, check }] of Object.entries(TARGETS)) {
    if (check === "elixir-override") continue;
    it(`${name}: .length, substring, padStart and padEnd answer in code points`, () => {
      check(target);
    });
  }
});

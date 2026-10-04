// IR vs language type-agreement census — FIRST PASS (report mode, no assertions yet).
import * as fs from "node:fs";
import { AstUtils, type AstNode } from "langium";
import { describe, expect, it } from "vitest";
import { lowerModel } from "../../src/ir/lower/lower.js";
import type { TypeIR } from "../../src/ir/types/loom-ir.js";
import { isLetStmt } from "../../src/language/generated/ast.js";
import type { DddType } from "../../src/language/type-system.js";
import { envForNode } from "../../src/language/type-system.js";
import { dddSourceOf, trackedDddFiles, UNPARSEABLE_DDD } from "../_helpers/ddd-corpus.js";
import { parseString } from "../_helpers/index.js";

export function langTypeKey(t: DddType | undefined): string {
  if (!t) return "(unbound)";
  switch (t.kind) {
    case "primitive": return `p:${t.name}`;
    case "id": return `id:${t.target.name}`;
    case "enum": return `enum:${t.ref.name}`;
    case "valueobject": return `vo:${t.ref.name}`;
    case "aggregate": case "entity": return `rec:${t.ref.name}`;
    case "payload": return `payload:${t.ref.name}`;
    case "array": return `[${langTypeKey(t.element)}]`;
    case "optional": return `${langTypeKey(t.inner)}?`;
    default: return t.kind;
  }
}

export function irTypeKey(t: TypeIR | undefined): string {
  if (!t) return "(none)";
  const a = t as unknown as Record<string, unknown> & { kind: string };
  switch (a.kind) {
    case "primitive": return `p:${a.name}`;
    case "id": return `id:${a.targetName}`;
    case "enum": return `enum:${a.name}`;
    case "valueobject": return `vo:${a.name}`;
    case "entity": return `rec:${a.name}`;
    case "array": return `[${irTypeKey(a.element as TypeIR)}]`;
    case "optional": return `${irTypeKey(a.inner as TypeIR)}?`;
    case "genericInstance": return `${a.ctor}<${irTypeKey(a.arg as TypeIR)}>`;
    case "union": return `union(${(a.variants as TypeIR[]).map(irTypeKey).join("|")})`;
    default: return a.kind;
  }
}

type Row = { file: string; key: string; ir?: string; lang?: string; owner?: string; nested?: string };

function irLets(root: unknown): Array<{ key: string; type: string }> {
  const out: Array<{ path: string; name: string; type: string }> = [];
  const seen = new Set<unknown>();
  const walk = (v: unknown, names: string[]) => {
    if (!v || typeof v !== "object" || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) { for (const x of v) walk(x, names); return; }
    const o = v as Record<string, unknown>;
    if (o.kind === "let" && typeof o.name === "string" && o.type && typeof o.type === "object" && "expr" in o) {
      out.push({ path: names.slice(-3).join("/"), name: o.name, type: irTypeKey(o.type as TypeIR) });
      return;
    }
    const next = typeof o.name === "string" && !("kind" in o && typeof o.kind === "string" && ["primitive","entity","enum","valueobject","id"].includes(o.kind as string)) ? [...names, o.name] : names;
    for (const [k, x] of Object.entries(o)) {
      if (k === "type" || k === "returnType" || k === "origin" || k === "$container") continue;
      walk(x, next);
    }
  };
  walk(root, []);
  return numbered(out);
}

function astLets(model: AstNode): Array<{ key: string; type: string }> {
  const out: Array<{ path: string; name: string; type: string }> = [];
  for (const n of AstUtils.streamAllContents(model)) {
    if (!isLetStmt(n)) continue;
    const names: string[] = [];
    let owner = "";
    for (let c = n.$container; c; c = c.$container) {
      if (!owner && c.$type !== "Block" && !c.$type.endsWith("Stmt") && c.$type !== "IfStatement") owner = c.$type;
      const nm = (c as { name?: unknown }).name;
      if (typeof nm === "string") names.unshift(nm);
    }
    let t: DddType | undefined;
    try { t = envForNode(n).resolve(n.name)?.type; } catch { t = undefined; }
    out.push({ path: names.slice(-3).join("/"), name: n.name, type: langTypeKey(t), owner, nested: n.$container?.$type ?? "" });
  }
  return numbered(out);
}

function numbered(xs: Array<{ path: string; name: string; type: string; owner?: string; nested?: string }>) {
  const seen = new Map<string, number>();
  return xs.map((x) => {
    const base = `${x.path}::${x.name}`;
    const i = seen.get(base) ?? 0;
    seen.set(base, i + 1);
    return { key: `${base}#${i}`, type: x.type, owner: x.owner, nested: x.nested };
  });
}

describe("IR vs language type agreement (report)", () => {
  it("measures", async () => {
    const files = trackedDddFiles().filter((f) => f !== UNPARSEABLE_DDD);
    const rows: Row[] = [];
    const lowerFail: string[] = [];
    for (const file of files) {
      let model;
      try { model = (await parseString(dddSourceOf(file), { validate: false })).model; } catch { continue; }
      if (!model) continue;
      let ir: unknown;
      try { ir = lowerModel(model); } catch { lowerFail.push(file); continue; }
      const al = astLets(model);
      const a = new Map(al.map((x) => [x.key, x.type]));
      const meta = new Map(al.map((x) => [x.key, { owner: x.owner, nested: x.nested }]));
      const b = new Map(irLets(ir).map((x) => [x.key, x.type]));
      for (const k of new Set([...a.keys(), ...b.keys()])) rows.push({ file, key: k, lang: a.get(k), ir: b.get(k), ...meta.get(k) });
    }
    const out = process.env.LOOM_CENSUS_REPORT;
    if (out) fs.writeFileSync(out, JSON.stringify({ files: files.length, lowerFail, rows }, null, 1));
    expect(files.length).toBeGreaterThan(50);
  }, 600_000);
});

import * as fs from "node:fs";
import { describe, expect, it } from "vitest";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { inferExprType, setLowerExprObserver } from "../../src/ir/lower/lower-expr.js";
import type { TypeIR } from "../../src/ir/types/loom-ir.js";
import type { Expression } from "../../src/language/generated/ast.js";
import type { DddType } from "../../src/language/type-system.js";
import { envForNode, typeOf } from "../../src/language/type-system.js";
import { dddSourceOf, trackedDddFiles, UNPARSEABLE_DDD } from "../_helpers/ddd-corpus.js";
import { parseString } from "../_helpers/index.js";

function lk(t: DddType | undefined): string {
  if (!t) return "(none)";
  switch (t.kind) {
    case "primitive":
      return `p:${t.name}`;
    case "id":
      return `id:${t.target.name}`;
    case "enum":
      return `enum:${t.ref.name}`;
    case "valueobject":
      return `vo:${t.ref.name}`;
    case "aggregate":
    case "entity":
    case "payload":
      return `rec:${t.ref.name}`;
    case "userclaim":
      return "rec:__User__";
    case "array":
      return `[${lk(t.element)}]`;
    case "optional":
      return `${lk(t.inner)}?`;
    case "action":
      return "action";
    default:
      return t.kind;
  }
}
function ik(t: TypeIR | undefined): string {
  if (!t) return "(none)";
  switch (t.kind) {
    case "primitive":
      return `p:${t.name}`;
    case "id":
      return `id:${t.targetName}`;
    case "enum":
      return `enum:${t.name}`;
    case "valueobject":
      return `vo:${t.name}`;
    case "entity":
      return `rec:${t.name}`;
    case "array":
      return `[${ik(t.element)}]`;
    case "optional":
      return `${ik(t.inner)}?`;
    case "genericInstance":
      return `${t.ctor}<${ik(t.arg)}>`;
    case "union":
      return `union(${t.variants.map(ik).join("|")})`;
    default:
      return t.kind;
  }
}

describe("typing shadow prototype", () => {
  it("measures", async () => {
    const files = trackedDddFiles().filter((f) => f !== UNPARSEABLE_DDD);
    const counts = new Map<string, number>();
    const bump = (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1);
    let total = 0;
    const samples: Record<string, string[]> = {};
    for (const f of files) {
      let parsed: Awaited<ReturnType<typeof parseString>>;
      try {
        parsed = await parseString(dddSourceOf(f), { validate: false });
      } catch {
        continue;
      }
      const seen = new Set<Expression>();
      let inObs = false;
      setLowerExprObserver((expr, env) => {
        if (inObs || seen.has(expr)) return;
        seen.add(expr);
        inObs = true;
        try {
          let ir = "(throws)",
            lang = "(throws)";
          try {
            ir = ik(inferExprType(expr, env));
          } catch {}
          try {
            lang = lk(typeOf(expr, envForNode(expr)));
          } catch {}
          total++;
          let cls: string;
          if (ir === lang) cls = "agree";
          else if (lang === "unknown" || lang === "any")
            cls = ir === "p:string" ? "lang-unknown/ir-string" : "lang-unknown/ir-typed";
          else if (ir === "p:string") cls = "ir-string/lang-typed";
          else cls = "both-differ";
          bump(cls);
          bump(`${cls}::${expr.$type}`);
          if (cls === "both-differ") {
            const k = `${expr.$type} ${lang} vs ${ir}`;
            samples[k] ??= [];
            if (samples[k].length < 2)
              samples[k].push(`${f}: ${expr.$cstNode?.text?.slice(0, 80)}`);
          }
        } finally {
          inObs = false;
        }
      });
      try {
        lowerModel(parsed.model);
      } catch {
        bump("lower-throws");
      }
      setLowerExprObserver(undefined);
    }
    const out = {
      total,
      counts: Object.fromEntries([...counts].sort((a, b) => b[1] - a[1])),
      samples,
    };
    fs.writeFileSync(process.env.PROTO_OUT ?? "/tmp/proto.json", JSON.stringify(out, null, 1));
    expect(total).toBeGreaterThan(0);
  }, 600_000);
});

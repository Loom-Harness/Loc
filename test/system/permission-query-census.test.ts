// One fact decides which operations have a permission query: an operation
// that is public, carries a `when` guard, and none of whose gates reads a
// parameter (a gate over a parameter has no answer before the arguments
// exist, so its button stays enabled and the submit answers 403/409).
//
// The fact lives twice, once per layer, because the scaffold macro runs on
// the AST before lowering:
//   - `isPermissionQueryOp` (src/ir/util/op-gates.ts) over `OperationIR` — the
//     derived `gateProbe` entry, every backend's probe, every frontend's hook;
//   - `hasPermissionQuery` (src/language/op-gate-params.ts) over the AST
//     `Operation` — the `can<Op><Agg>` handler and route `scaffoldHandlers` /
//     `scaffoldApi` emit.
//
// This census holds three things:
//   - the two twins agree on every operation of every shipped model, so a
//     scaffolded handler always claims exactly the slot the derived probe
//     would serve, and no op is served twice or not at all;
//   - no emitter re-derives the decision from `op.when` beside them;
//   - an op is never served twice: every routed scaffolded `can<Op><Agg>`
//     claims the slot of the op's derived `gateProbe`, so the derived probe
//     is not routed beside it.

import fs from "node:fs";
import path from "node:path";
import { AstUtils } from "langium";
import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { routeContext, routeHandlerName } from "../../src/ir/plan/route-handler.js";
import { deriveContextOperations } from "../../src/ir/util/api-surface.js";
import { isPermissionQueryOp } from "../../src/ir/util/op-gates.js";
import { isAggregate, isBoundedContext, isOperation } from "../../src/language/generated/ast.js";
import { hasPermissionQuery } from "../../src/language/op-gate-params.js";
import { canHandlerName } from "../../src/macros/stdlib/scaffold/_handlers-shared.js";
import { expectReach } from "../_helpers/census-reach.js";
import { dddSourceOf, trackedDddFiles } from "../_helpers/ddd-corpus.js";
import { parseString } from "../_helpers/parse.js";

const repo = path.resolve(__dirname, "../..");

function tsFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return tsFiles(p);
    return e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") ? [p] : [];
  });
}

const rel = (p: string) => path.relative(repo, p).split(path.sep).join("/");

/** Spellings that decide "this op has a permission query" from `when` alone:
 *  `visibility === "public" && op.when` and `gated: !!op.when`. */
const REDERIVATION = [
  /visibility\s*===\s*"public"\s*&&\s*!{0,2}\w+\.when\b/,
  /\bgated\s*:\s*!{0,2}\w+\.when\b/,
];

/** Sites that read `when` for a different decision, with the reason. */
const WAIVED: Record<string, string> = {
  "src/generator/java/emit/service.ts":
    "the set of operations whose `when` answers 409 on submit, not the permission query",
};

/** Every tracked `.ddd` — the corpus, the examples, the fixtures — that
 *  parses clean. */
const corpusFiles = () => trackedDddFiles().filter((f) => f.endsWith(".ddd"));

describe("permission query census", () => {
  it("no emitter re-derives the permission-query decision from `when`", () => {
    const files = [
      ...tsFiles(path.join(repo, "src/generator")),
      ...tsFiles(path.join(repo, "src/platform")),
    ].map(rel);
    expectReach("emitter files", files.length, 750);
    const offenders = files.filter((f) => {
      const code = fs
        .readFileSync(path.join(repo, f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      return REDERIVATION.some((re) => re.test(code));
    });
    expect(offenders.filter((f) => !(f in WAIVED))).toEqual([]);
    // A waiver whose site no longer matches is stale.
    expect(Object.keys(WAIVED).filter((f) => !offenders.includes(f))).toEqual([]);
  });

  it("the AST and IR twins agree on every operation of every shipped model", async () => {
    const disagree: string[] = [];
    let ops = 0;
    let queries = 0;
    for (const file of corpusFiles()) {
      const { model, errors } = await parseString(dddSourceOf(file), { validate: true });
      if (errors.length > 0) continue;
      const ast = new Map<string, boolean>();
      for (const node of AstUtils.streamAllContents(model)) {
        if (!isOperation(node) || !isAggregate(node.$container)) continue;
        const ctx = AstUtils.getContainerOfType(node, isBoundedContext);
        if (!ctx) continue;
        ast.set(`${ctx.name}.${node.$container.name}.${node.name}`, hasPermissionQuery(node));
      }
      const loom = enrichLoomModel(lowerModel(model));
      for (const sys of loom.systems) {
        for (const sd of sys.subdomains) {
          for (const ctx of sd.contexts) {
            for (const agg of ctx.aggregates) {
              for (const op of agg.operations) {
                const key = `${ctx.name}.${agg.name}.${op.name}`;
                const twin = ast.get(key);
                if (twin === undefined) continue; // synthesised by lowering, not by source
                ops++;
                const ir = isPermissionQueryOp(op);
                if (ir) queries++;
                if (ir !== twin) disagree.push(`${file}: ${key} ir=${ir} ast=${twin}`);
              }
            }
          }
        }
      }
    }
    expectReach("operations compared", ops, 1000);
    expectReach("permission queries compared", queries, 20);
    expect(disagree).toEqual([]);
  }, 300_000);

  it("a routed permission-query handler claims the derived probe's slot", async () => {
    const unclaimed: string[] = [];
    let routed = 0;
    for (const file of corpusFiles()) {
      const { model, errors } = await parseString(dddSourceOf(file), { validate: true });
      if (errors.length > 0) continue;
      const loom = enrichLoomModel(lowerModel(model));
      for (const sys of loom.systems) {
        const contexts = sys.subdomains.flatMap((sd) => sd.contexts);
        for (const route of sys.apis.flatMap((a) => a.routes ?? [])) {
          const ctx = contexts.find((c) => c.name === routeContext(route));
          if (!ctx) continue;
          const handler = routeHandlerName(route, ctx);
          for (const agg of ctx.aggregates) {
            for (const op of agg.operations.filter(isPermissionQueryOp)) {
              if (canHandlerName(op.name, agg.name) !== handler) continue;
              routed++;
              const probe = deriveContextOperations(ctx).find(
                (o) => o.kind === "gateProbe" && o.aggregate === agg.name && o.operation === op,
              );
              if (!probe?.claimedByExplicitRoute)
                unclaimed.push(`${file}: ${route.method} ${route.path} -> ${handler}`);
            }
          }
        }
      }
    }
    expectReach("routed permission-query handlers", routed, 1);
    expect(unclaimed).toEqual([]);
  }, 300_000);
});

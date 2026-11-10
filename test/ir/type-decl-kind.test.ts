// An `entity` TypeIR names its declaration kind (`declKind`), resolved once in
// lowering, so no consumer looks the name up again to learn whether it is an
// aggregate, a part, an event, a payload of some kind, or a workflow.
//
// The census: across every corpus fixture, each `entity` type anywhere in the
// enriched model names a declaration of exactly the kind it claims.  A type
// that claims `aggregate` for a part, or `payload` for an `error`, fails here —
// and every consumer that switches on `declKind` would have mis-emitted it.

import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { allContexts, type EntityDeclKind, type TypeIR } from "../../src/ir/types/loom-ir.js";
import { dddSourceOf, REPO_ROOT } from "../_helpers/ddd-corpus.js";
import { parseString } from "../_helpers/parse.js";

const CORPUS = "test/fixtures/corpus";

type EntityType = Extract<TypeIR, { kind: "entity" }>;

/** Every `entity` TypeIR reachable from `root` — a structural sweep over the
 *  plain-data IR, so a type in any position (field, param, return, binding,
 *  receiver, wire shape) is counted without naming each position. */
function entityTypes(root: unknown): EntityType[] {
  const out: EntityType[] = [];
  const seen = new WeakSet<object>();
  const visit = (v: unknown): void => {
    if (v === null || typeof v !== "object" || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) {
      for (const x of v) visit(x);
      return;
    }
    const o = v as Record<string, unknown>;
    if (o.kind === "entity" && typeof o.name === "string" && "declKind" in o) {
      out.push(o as unknown as EntityType);
    }
    for (const x of Object.values(o)) visit(x);
  };
  visit(root);
  return out;
}

/** The declarations a fixture declares, as `declKind:name` keys. */
function catalogue(model: ReturnType<typeof enrichLoomModel>): Set<string> {
  const keys = new Set<string>();
  for (const ctx of allContexts(model)) {
    for (const a of ctx.aggregates) {
      keys.add(`aggregate:${a.name}`);
      for (const p of a.parts) keys.add(`part:${p.name}`);
    }
    for (const p of ctx.payloads) keys.add(`${p.kind}:${p.name}`);
    for (const e of ctx.events) keys.add(`event:${e.name}`);
    for (const w of ctx.workflows) keys.add(`workflow:${w.name}`);
    for (const p of ctx.projections ?? []) keys.add(`projection:${p.name}`);
  }
  return keys;
}

/** Kinds that name a declaration the catalogue lists. */
const DECLARED: ReadonlySet<EntityDeclKind> = new Set<EntityDeclKind>([
  "aggregate",
  "part",
  "workflow",
  "projection",
  "payload",
  "event",
  "command",
  "query",
  "response",
  "error",
]);

describe("TypeIR entity declKind", () => {
  const fixtures = readdirSync(resolve(REPO_ROOT, CORPUS))
    .filter((f) => f.endsWith(".ddd"))
    .sort();

  it("names a declaration of the kind it claims, in every corpus fixture", async () => {
    const wrong: string[] = [];
    const reached = new Set<EntityDeclKind>();
    for (const f of fixtures) {
      const { model } = await parseString(dddSourceOf(`${CORPUS}/${f}`), { validate: false });
      const enriched = enrichLoomModel(lowerModel(model));
      const declared = catalogue(enriched);
      for (const t of entityTypes(enriched)) {
        reached.add(t.declKind);
        if (!DECLARED.has(t.declKind)) continue;
        // A misnamed reference (`Unknown`) is the validator's to refuse.
        if (t.name === "Unknown") continue;
        if (!declared.has(`${t.declKind}:${t.name}`)) wrong.push(`${f}: ${t.declKind} ${t.name}`);
      }
    }
    expect([...new Set(wrong)]).toEqual([]);
    // The census reaches every kind a declaration can lower to.
    for (const k of [
      "aggregate",
      "part",
      "event",
      "payload",
      "error",
      "workflow",
      "principal",
    ] as const) {
      expect(reached, k).toContain(k);
    }
  }, 120_000);
});

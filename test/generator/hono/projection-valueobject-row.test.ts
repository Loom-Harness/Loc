// node/Hono — a `valueobject` field on a FOLDED PROJECTION's read model.
//
// The shared phase-⑨ `MigrationsIR` spreads a value-object field into one column
// per leaf (`st: Stamp { atTime, who }` → `st_at_time` / `st_who`), and both node
// adapters name the row PROPS the same way (`st_atTime` / `st_who`) — while the
// response DTO declares the value object NESTED, which is what java's
// `StampResponse` and .NET's / python's response records publish too.
//
// The node folded-projection emitter bridged neither half, so a `.ddd` that
// validates `0 error(s), 0 warning(s)` emitted a project that does not compile:
//
//   * the fold wrote `state.st = e.st` — a prop the row type does not have
//     (`TS2339`), because the row holds the LEAVES;
//   * the response schema said `st: StampSchema.nullish()` with `StampSchema`
//     declared nowhere in the tree (`TS2304`).
//
// The WORKFLOW emitter had already grown the second half (`workflowSchemaSeeds`,
// #2864 D4 — a workflow whose state carried an enum named an undeclared
// `ClaimStateSchema`); the projection emitter never did.  Same "one emitter of
// two got the fix" shape as #3072.
//
// Silent on every gate: nothing in the corpus carries a value object on a folded
// projection, so no tier ever compiled or booted one.

import { describe, expect, it } from "vitest";
import { isFlattenedValueObject, voLeaves } from "../../../src/generator/typescript/vo-flatten.js";
import { enrichLoomModel } from "../../../src/ir/enrich/enrichments.js";
import { lowerModel, mergeLoomModels } from "../../../src/ir/lower/lower.js";
import { generateSystemFiles } from "../../_helpers/generate.js";
import { parseString } from "../../_helpers/parse.js";

const SOURCE = (persistence = ""): string => `
system V {
  subdomain S {
    context C {
      valueobject Stamp { atTime: datetime  who: string }
      valueobject Audit { made: Stamp  note: string? }
      aggregate Order with crudish {
        customerId: string
        operation place() {
          emit OrderPlaced {
            orderRef: id,
            st: Stamp { atTime: now(), who: "a" },
            au: Audit { made: Stamp { atTime: now(), who: "b" }, note: "n" }
          }
        }
      }
      repository Orders for Order { }
      event OrderPlaced { orderRef: Order id, st: Stamp, au: Audit }
      projection OrderBoard keyed by orderRef {
        orderRef: Order id
        st: Stamp
        seen: Stamp?
        au: Audit
        on(e: OrderPlaced) { orderRef := e.orderRef  st := e.st  seen := e.st  au := e.au }
      }
    }
  }
  api A from S
  storage pg { type: postgres }
  resource state { for: C, kind: state, use: pg }
  deployable d {
    platform: node${persistence}
    contexts: [C]
    dataSources: [state]
    serves: A
    port: 4000
  }
}`;

describe("node folded projection — a value-object row field", () => {
  // Both adapters flatten to the SAME row props, so both halves must agree for
  // both; the emitted route text is identical, which is the point.
  for (const [label, persistence] of [
    ["drizzle", ""],
    ["mikroorm", " { persistence: mikroorm }"],
  ] as const) {
    describe(label, () => {
      it("declares the value-object schemas its response DTO references", async () => {
        const proj = (await generateSystemFiles(SOURCE(persistence))).get("d/http/projections.ts")!;
        // The TS2304 half: the DTO names these, so the file must declare them —
        // including `Audit`, reachable only as a sibling, and `Stamp`, reachable
        // BOTH directly and through `Audit`.
        expect(proj).toContain("const StampSchema = z.object({");
        expect(proj).toContain("const AuditSchema = z.object({");
        expect(proj).toContain("  st: StampSchema.nullish(),");
        expect(proj).toContain("  au: AuditSchema.nullish(),");
        // A nested value object's schema references its child's, so the child
        // must be declared FIRST or the const is used before initialisation.
        expect(proj.indexOf("const StampSchema")).toBeLessThan(proj.indexOf("const AuditSchema"));
      });

      it("folds a value-object write into the row's LEAF props", async () => {
        const proj = (await generateSystemFiles(SOURCE(persistence))).get("d/http/projections.ts")!;
        // The TS2339 half: the domain value is bound once, then spread over the
        // leaves the row actually has.
        expect(proj).toContain("const __st = e.st;");
        expect(proj).toContain("state.st_atTime = __st.atTime;");
        expect(proj).toContain("state.st_who = __st.who;");
        // A NESTED value object recurses to `au_made_*`.
        expect(proj).toContain("state.au_made_atTime = __au.made.atTime;");
        expect(proj).toContain("state.au_made_who = __au.made.who;");
        expect(proj).toContain("state.au_note = __au.note;");
        // An OPTIONAL value-object field hops with `?.` — an absent ancestor
        // makes every descendant absent.
        expect(proj).toContain("state.seen_atTime = __seen?.atTime;");
        // The pre-fix spelling: the whole domain value assigned to one prop.
        expect(proj).not.toMatch(/state\.(st|au|seen) = /);
      });

      it("rebuilds the nest on the read routes, and canonicalises a datetime leaf", async () => {
        const proj = (await generateSystemFiles(SOURCE(persistence))).get("d/http/projections.ts")!;
        // A REQUIRED value object is built unconditionally; its `datetime` leaf
        // rides the RS-4 instant helper exactly as a top-level one does.
        expect(proj).toContain("st: { atTime: __wireInstant(row.st_atTime), who: row.st_who }");
        // A DECLARED-OPTIONAL one answers `null` when it was never written —
        // .NET's `x.St is null ? null : new StampResponse(...)` shape — probed on
        // a leaf the value object itself requires.
        expect(proj).toContain(
          "seen: row.seen_atTime == null ? null : { atTime: __wireInstant(row.seen_atTime), who: row.seen_who }",
        );
        // Nested, and not double-guarded.
        expect(proj).toContain(
          "au: { made: { atTime: __wireInstant(row.au_made_atTime), who: row.au_made_who }, note: row.au_note }",
        );
        // The spread cannot serve this shape: it would ship the LEAF props and no
        // `st` at all.
        expect(proj).not.toContain("{ ...row,");
        expect(proj).not.toContain("{ ...r,");
        // Both routes project, not just the by-key one.
        expect(proj).toContain("rows.map((r) => ({ orderRef: r.orderRef,");
      });
    });
  }

  it("a projection with no value object keeps the row spread byte-identically", async () => {
    // The churn half: only a shape that actually needs the explicit projection
    // gets it, so every other emitted tree is untouched.
    const proj = (
      await generateSystemFiles(`
system N {
  subdomain S {
    context C {
      aggregate Order with crudish {
        customerId: string
        operation place() { emit OrderPlaced { orderRef: id, at: now() } }
      }
      repository Orders for Order { }
      event OrderPlaced { orderRef: Order id, at: datetime }
      projection Plain keyed by orderRef {
        orderRef: Order id
        at: datetime
        on(e: OrderPlaced) { orderRef := e.orderRef  at := e.at }
      }
    }
  }
  api A from S
  storage pg { type: postgres }
  resource state { for: C, kind: state, use: pg }
  deployable d { platform: node  contexts: [C]  dataSources: [state]  serves: A  port: 4000 }
}`)
    ).get("d/http/projections.ts")!;
    expect(proj).toContain("{ ...row, at: __wireInstant(row.at) }");
    expect(proj).not.toContain("Schema = z.object({");
  });

  // The DRIFT PIN.  `voLeaves` mirrors a column layout owned by two other
  // emitters (`drizzleColumnLinesForName` in `emit/schema.ts`,
  // `columnsForType` in `emit/mikroorm-entities.ts`).  A mirror with no gate is
  // the defect this file exists for, one level down — so the leaf names are
  // checked against the props those emitters ACTUALLY emit, for both adapters.
  it("derives exactly the leaf props the two column emitters emit", async () => {
    const { model } = await parseString(SOURCE(), { validate: false });
    const sys = enrichLoomModel(mergeLoomModels([lowerModel(model)])).systems[0]!;
    const ctx = sys.subdomains.flatMap((sd) => sd.contexts).find((c) => c.name === "C")!;
    const board = ctx.projections.find((p) => p.name === "OrderBoard")!;

    const derived = new Set<string>();
    for (const f of board.stateFields) {
      if (!isFlattenedValueObject(f.type, ctx)) continue;
      for (const l of voLeaves(f.name, f.type, ctx)) derived.add(l.prop);
    }
    expect([...derived].sort()).toEqual([
      "au_made_atTime",
      "au_made_who",
      "au_note",
      "seen_atTime",
      "seen_who",
      "st_atTime",
      "st_who",
    ]);

    // …and the same names really are the emitted row props, on each adapter.
    const drizzle = (await generateSystemFiles(SOURCE())).get("d/db/schema.ts")!;
    const table = drizzle.slice(drizzle.indexOf("orderBoards = "));
    const mikro = (await generateSystemFiles(SOURCE(" { persistence: mikroorm }"))).get(
      "d/db/entities.ts",
    )!;
    const entity = mikro.slice(mikro.indexOf("class OrderBoardRow"));
    for (const prop of derived) {
      expect(table, `drizzle column prop ${prop}`).toContain(`${prop}: `);
      expect(entity, `mikro entity prop ${prop}`).toContain(`${prop}!: `);
    }
  });
});

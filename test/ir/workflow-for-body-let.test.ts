// A `let` inside a workflow `for` body binds for the rest of that body.
//
// It did not, for the VALIDATOR only:
//
//     for l in ls { let p = Parts.getById(l.partId)  p.consume(l.qty) }
//     -> loom.workflow-foreach-unknown-binding: 'p.consume(...)' references
//        unknown binding 'p'
//
// The `for-each` arm walked the loop body looking only for `op-call`s and never
// recorded the `repo-let`/`factory-let` bindings it passed on the way.  So the
// diagnostic pointed at the USE, one line below a `let` that plainly declares
// the name — which reads as "you have a typo", not "this shape is unsupported"
// (F-002).
//
// And the shape IS supported.  Every one of the five backends already emits the
// loop correctly — verified by generating, not by reading the emitters:
//
//   node    const p = await parts.getById(l.partId); p.consume(l.qty); await parts.save(p);
//   java    var p = partsRepository.getById(l.partId()); p.consume(l.qty()); …save(p);
//   python  p = await parts.get_by_id(l.part_id); p.consume(l.qty); await parts.save(p)
//   dotnet  var p = await _parts.GetByIdAsync(…) ?? throw …; p.Consume(l.Qty); …
//   elixir  with {:ok, p} <- Context.get_part(l.part_id), {:ok, _} <- Context.consume_part(p, …)
//
// so this was a validator false-negative refusing a shape the whole toolchain
// handles, not an honest gap.
import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { parseString } from "../_helpers/parse.js";

const sys = (platform: string) => `
system X {
  subdomain S {
    context C {
      aggregate Part { sku: string  stockOnHand: int
        operation consume(qty: int) { precondition stockOnHand >= qty  stockOnHand := stockOnHand - qty } }
      aggregate Order { note: string }
      aggregate Line { orderId: Order id  partId: Part id  qty: int }
      criterion LinesOf(o: Order id) of Line = this.orderId == o
      repository Parts for Part { }
      repository Orders for Order { }
      repository Lines for Line { }
      workflow finishB {
        create(orderId: Order id) {
          let ls = Lines.run(LinesOf(orderId))
          for l in ls { let p = Parts.getById(l.partId)  p.consume(l.qty) }
        }
      }
    }
  }
  storage p { type: postgres }
  resource r { for: C, kind: state, use: p }
  deployable api { platform: ${platform}, contexts: [C], dataSources: [r], port: 3000 }
}
`;

async function errorCodes(source: string): Promise<string[]> {
  const { model } = await parseString(source, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model)))
    .filter((d) => d.severity === "error")
    .map((d) => d.code ?? "");
}

describe("a `let` in a workflow `for` body is in scope after it", () => {
  it("no longer reports the binding as unknown", async () => {
    expect(await errorCodes(sys("node"))).not.toContain("loom.workflow-foreach-unknown-binding");
  });

  it("validates clean", async () => {
    expect(await errorCodes(sys("node"))).toEqual([]);
  });

  it("a genuinely unbound name in the loop IS still reported", async () => {
    // The fix records real bindings; it does not stop the check working.  A
    // relaxation that swallowed the whole diagnostic would pass the two
    // assertions above and be worthless.
    const bogus = sys("node").replace(
      "for l in ls { let p = Parts.getById(l.partId)  p.consume(l.qty) }",
      "for l in ls { q.consume(l.qty) }",
    );
    expect(await errorCodes(bogus)).toContain("loom.workflow-foreach-unknown-binding");
  });

  /** Per-backend markers for LOAD, MUTATE and PERSIST inside the loop.
   *
   *  Spelled per target rather than grepped generically because the idioms
   *  genuinely differ, and flattening them hides a real difference: the four
   *  imperative backends emit an explicit `save(p)` after the mutation, while
   *  Phoenix persists INSIDE the context function (`consume_part` ends in
   *  `persist_change()`), so there is no separate save to look for.  A single
   *  `/save/i` assertion reported elixir as broken when it was the assertion
   *  that was wrong about elixir. */
  const EMITS: Record<string, readonly [load: RegExp, mutate: RegExp, persist: RegExp]> = {
    node: [/parts\.getById\(/, /p\.consume\(/, /parts\.save\(p\)/],
    dotnet: [/_parts\.GetByIdAsync\(/, /p\.Consume\(/, /_parts\.SaveAsync\(p/],
    java: [/partsRepository\.getById\(/, /p\.consume\(/, /partsRepository\.save\(p\)/],
    python: [/parts\.get_by_id\(/, /p\.consume\(/, /parts\.save\(p\)/],
    // Phoenix: the `with` chain loads, and the context function it calls both
    // mutates and persists.
    elixir: [/Context\.get_part\(/, /Context\.consume_part\(p/, /persist_change\(\)/],
  };

  it.each(
    Object.keys(EMITS),
  )("%s emits load + mutate + persist inside the loop", async (platform) => {
    const files = await generateSystemFiles(sys(platform));
    const all = [...files.values()].join("\n");
    const [load, mutate, persist] = EMITS[platform]!;
    // Asserting only that generation succeeded would pass on a backend that
    // dropped the loop body entirely — which is exactly the silent shape this
    // whole register is about.
    expect(all, `${platform}: no load in the loop`).toMatch(load);
    expect(all, `${platform}: no mutation in the loop`).toMatch(mutate);
    expect(all, `${platform}: mutation is never persisted`).toMatch(persist);
  }, 60_000);
});

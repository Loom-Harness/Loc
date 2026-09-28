// A containment graph must be a TREE.
//
// `entity Child { contains kids: Child[] }` is not merely unsupported, it is
// unrepresentable: an aggregate is loaded whole, so a part containing itself
// names a value with no finite serialisation.  Nothing said so — `ddd parse`
// answered `0 error(s), 0 warning(s)` and `ddd generate system` then died with
// a bare `RangeError: Maximum call stack size exceeded` out of
// `nestedContainLoads`, a stack trace on a model the tool had just called valid
// (F-040).
//
// The shape is easy to reach by accident because the DOMAIN is ordinary — a
// sub-task tree, a bill of materials, a threaded comment — so the diagnostic
// names the modelling that does work, and this suite pins that it does.
import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { parseString } from "../_helpers/parse.js";

const sys = (body: string) => `
system X {
  subdomain S {
    context C {
${body}
      repository Node1s for Node1 { }
    }
  }
  storage p { type: postgres }
  resource r { for: C, kind: state, use: p }
  deployable api { platform: node, contexts: [C], dataSources: [r], port: 3000 }
}
`;

async function diagnose(source: string) {
  const { model } = await parseString(source, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model))).filter(
    (d) => d.severity === "error",
  );
}

/** Direct self-containment — the repro's shape. */
const DIRECT =
  sys(`      aggregate Node1 with crudish { label: string  derived display: string = label
        contains kids: Child[]
        entity Child { label: string  contains kids: Child[] } }`);

/** A THREE-part cycle: A → B → C → A.  The one that makes the chain in the
 *  message earn its place — "Child contains Child" is self-evident, this is
 *  not. */
const INDIRECT =
  sys(`      aggregate Node1 with crudish { label: string  derived display: string = label
        contains a: PartA
        entity PartA { label: string  contains b: PartB }
        entity PartB { label: string  contains c: PartC }
        entity PartC { label: string  contains a: PartA } }`);

/** A DIAMOND — two parts both containing a third.  Legal: the graph is acyclic,
 *  it merely is not a strict tree by reference.  A cycle check written with a
 *  single `seen` set (rather than a current-path set) would reject this, which
 *  is the easy way to get this check wrong. */
const DIAMOND =
  sys(`      aggregate Node1 with crudish { label: string  derived display: string = label
        contains l: Left
        contains r: Right
        entity Left { label: string  contains leaf: Leaf }
        entity Right { label: string  contains leaf: Leaf }
        entity Leaf { label: string } }`);

/** The shape the diagnostic RECOMMENDS.  If this did not work the message
 *  would be sending authors somewhere no better than where they are. */
const SELF_REF = sys(
  `      aggregate Node1 with crudish { label: string  parentId: Node1 id?  derived display: string = label }`,
);

describe("cyclic containment is refused, not crashed on", () => {
  it("direct self-containment raises loom.containment-cycle", async () => {
    const codes = (await diagnose(DIRECT)).map((d) => d.code);
    expect(codes).toContain("loom.containment-cycle");
  });

  it("an indirect cycle names the whole chain", async () => {
    const d = (await diagnose(INDIRECT)).find((x) => x.code === "loom.containment-cycle");
    expect(d, "no cycle reported for A -> B -> C -> A").toBeDefined();
    // Every member named, in order — a message that said only "PartA" would
    // leave the author to find the other two edges by hand.
    expect(d!.message).toContain("PartA contains PartB contains PartC contains PartA");
  });

  it("reports a cycle ONCE, not once per entry point", async () => {
    const cycles = (await diagnose(INDIRECT)).filter((d) => d.code === "loom.containment-cycle");
    expect(cycles).toHaveLength(1);
  });

  it("a diamond is NOT a cycle", async () => {
    // The whole reason the walk tracks the current path rather than a flat
    // `seen` set.  Two parts may both contain a third.
    const codes = (await diagnose(DIAMOND)).map((d) => d.code);
    expect(codes).not.toContain("loom.containment-cycle");
  });

  it("the self-reference the message recommends actually generates", async () => {
    expect(await diagnose(SELF_REF)).toEqual([]);
    const files = await generateSystemFiles(SELF_REF);
    expect(files.size).toBeGreaterThan(10);
  }, 60_000);
});

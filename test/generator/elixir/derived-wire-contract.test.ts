// M-T6.56 / language-docs audit F60 — the Phoenix wire must ship every key its
// own OpenAPI schema marks `required:`.
//
// `derivedRenderable` (`vanilla/wire-serialize.ts`) refused a `this-derived`
// read, so `derived label = "n=" + withTax` (a derived reading another derived)
// was SKIPPED from `serialize/1` — while the emitted `OrderResponse` schema
// declared `label` AND listed it in `required:`.  Every response therefore
// violated the contract the app publishes, on elixir alone (the other four
// backends compute the chain), with no `loom.*` code to say so.
//
// The renderer was never the blocker: `render-expr.ts` already INLINES a
// `this-derived` read, because an Elixir struct carries no computed field and
// `record.<name>` would raise `KeyError` (#1765).  Only the projection
// PREDICATE disagreed with it.
//
// The gate is the invariant, not the one field: for EVERY aggregate response
// schema in the generated project, `required:` must equal the key set
// `serialize/1` emits.  The expected value comes from the OpenAPI the backend
// publishes, not from the serializer's own emitter (rule 12).

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = `
system Shop {
  subdomain Sales {
    context Ordering {
      aggregate Order with crudish {
        qty: int
        unitPrice: int
        derived subtotal: int = qty * unitPrice
        derived withTax: int = subtotal + subtotal
        derived label: string = "n=" + withTax
      }
      repository Orders for Order { }
      aggregate Coupon with crudish {
        code: string
        pct: int
        derived doubled: int = pct + pct
        derived shout: string = code + doubled
      }
      repository Coupons for Coupon { }
    }
  }
  api OrderingApi from Sales
  storage primary { type: postgres }
  resource orderingState { for: Ordering, kind: state, use: primary }
  deployable api {
    platform: elixir
    contexts: [Ordering]
    dataSources: [orderingState]
    serves: OrderingApi
    port: 4000
  }
}
`;

/** `required: [:a, :b]` off a generated OpenApiSpex schema module. */
function requiredKeys(schema: string): string[] {
  const m = /required:\s*\[([^\]]*)\]/.exec(schema);
  if (!m) throw new Error("schema has no `required:` list");
  return m[1]!
    .split(",")
    .map((s) => s.trim().replace(/^:/, ""))
    .filter((s) => s.length > 0)
    .sort();
}

/** The string keys the controller's own `defp serialize(record)` map emits. */
function serializeKeys(controller: string): string[] {
  const start = controller.indexOf("defp serialize(record) do");
  if (start < 0) throw new Error("controller has no `defp serialize(record)`");
  const end = controller.indexOf("\n  end", start);
  return [...controller.slice(start, end).matchAll(/^\s*"([^"]+)" =>/gm)].map((m) => m[1]!).sort();
}

describe("phoenix wire — `serialize/1` ships every key the published schema requires (F60)", () => {
  it("sweeps every aggregate response schema in the project", async () => {
    const files = await generateSystemFiles(SRC);
    // The per-aggregate READ schema (`<agg>_response.ex`) — not the create /
    // list carriers, whose shapes are the create-input and the paged envelope.
    const aggNames = ["coupon", "order"];
    const schemas = aggNames.map((a) => {
      const k = [...files.keys()].find((x) => x.endsWith(`api/schemas/${a}_response.ex`));
      if (!k) throw new Error(`no response schema for ${a}`);
      return k;
    });
    // Vacuity guard — the fixture must actually carry a derived CHAIN on each
    // aggregate, or the sweep passes trivially (§104's second bug).
    for (const k of schemas) {
      expect(requiredKeys(files.get(k)!).length, `${k}: schema has no fields`).toBeGreaterThan(3);
    }
    for (const schemaKey of schemas) {
      const agg = schemaKey.split("/").pop()!.replace("_response.ex", "");
      const ctrlKey = [...files.keys()].find((k) => k.endsWith(`controllers/${agg}_controller.ex`));
      expect(ctrlKey, `no controller for ${agg}`).toBeDefined();
      expect(
        serializeKeys(files.get(ctrlKey!)!),
        `${agg}: serialize/1 keys vs the schema's own required:`,
      ).toEqual(requiredKeys(files.get(schemaKey)!));
    }
  });

  it("projects a derived that READS another derived, inlined to the stored columns", async () => {
    const files = await generateSystemFiles(SRC);
    const ctrl = files.get(
      [...files.keys()].find((k) => k.endsWith("controllers/order_controller.ex"))!,
    )!;
    const keys = serializeKeys(ctrl);
    expect(keys).toContain("withTax");
    expect(keys).toContain("label");
    // The inline reaches all the way down to stored columns — no `record.subtotal`
    // (a struct key that does not exist, so a `KeyError` at render time).
    expect(ctrl).not.toContain("record.subtotal");
    expect(ctrl).not.toContain("record.with_tax");
    expect(ctrl).toContain(
      `"withTax" => (record.qty * record.unit_price) + (record.qty * record.unit_price)`,
    );
  });

  it("declines a derived whose chain bottoms out on something the serializer cannot evaluate", async () => {
    // A `function` call needs the context-facade module the serializer does not
    // host, so `viaFn` cannot project — and neither can `alsoViaFn`, which reads
    // it: inlining would emit an unbound `twice(record)` inside the controller.
    // Both must stay out of `serialize/1` AND out of the schema's `required:`,
    // which the sweep above asserts for every aggregate.
    const files = await generateSystemFiles(`
system Shop {
  subdomain Sales {
    context Ordering {
      aggregate Order with crudish {
        qty: int
        function twice(): int = qty + qty
        derived viaFn: int = twice()
        derived alsoViaFn: int = viaFn
      }
      repository Orders for Order { }
    }
  }
  api OrderingApi from Sales
  storage primary { type: postgres }
  resource orderingState { for: Ordering, kind: state, use: primary }
  deployable api {
    platform: elixir
    contexts: [Ordering]
    dataSources: [orderingState]
    serves: OrderingApi
    port: 4000
  }
}
`);
    const ctrl = files.get(
      [...files.keys()].find((k) => k.endsWith("controllers/order_controller.ex"))!,
    )!;
    const keys = serializeKeys(ctrl);
    expect(keys).not.toContain("viaFn");
    expect(keys).not.toContain("alsoViaFn");

    // CHARACTERIZATION of the residue F60 does NOT close.  The published schema
    // still declares both fields and still lists them in `required:`, so this
    // shape keeps the same self-contradicting contract the derived-reads-derived
    // shape had — by a different mechanism: an aggregate `function` is emitted
    // on the CONTEXT FACADE module (`def twice(%Order{} = record)`), which the
    // controller that hosts `serialize/1` does not host, so inlining would emit
    // an unbound `twice(record)`.  Closing it means qualifying the call at this
    // one site (a `RenderCtx` seam), and the document / part / value-object
    // serializers pass a DIFFERENT struct than the facade's guarded clause head
    // accepts — its own slice.  Pinned here so it is visible and so the day it
    // is fixed (or widened) this test says so.
    const schema = files.get(
      [...files.keys()].find((k) => k.endsWith("api/schemas/order_response.ex"))!,
    )!;
    expect(requiredKeys(schema)).toContain("viaFn");
    expect(requiredKeys(schema)).toContain("alsoViaFn");
  });
});

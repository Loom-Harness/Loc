// A ROOT-LEVEL (shared-kernel) value object nested in a CONTEXT-LOCAL one must
// be declared before the local one that uses it, on every backend that emits
// VO declarations with an initialisation order.
//
// `valueObjectPool(ctx)` / `ctx.valueObjects` list the context's own VOs first
// and the root-level ones folded in at enrichment after them, so an emitter that
// writes declarations in pool order produces:
//
//   node    const OuterSchema = z.object({ origin: UnLocodeSchema, … })
//           const UnLocodeSchema = z.object({ … })
//           → TS2448/TS2454, a temporal-dead-zone read: the module throws on
//             load, so the generated API does not boot
//   python  class Outer: origin: UnLocode   …   class UnLocode:   → ruff F821
//
// node emits `<Vo>Schema` consts from FOUR builders (routes, workflows, folded
// projections, explicit handlers), each with its own pool walk; python from two
// (domain value objects, wire models).  This model reaches every one of them,
// and the vacuity guard pins that it still does — an ordering regression at a
// site the model stopped reaching would otherwise pass here.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const SRC = (platform: string) => `
valueobject UnLocode {
  value: string
}
system Kernel {
  subdomain Freight {
    context Routing {
      valueobject Outer {
        origin: UnLocode
      }
      aggregate Shipment with crudish {
        reference: string
        route: Outer
        operation reroute(to: Outer) {
          route := to
          emit Rerouted { shipment: id, route: to }
        }
      }
      repository Shipments for Shipment { }
      event Rerouted { shipment: Shipment id, route: Outer }
      channel Moves {
        carries: Rerouted
        delivery: broadcast
        retention: ephemeral
      }
      projection LastRoute keyed by shipment {
        shipment: Shipment id
        route: Outer
        on(e: Rerouted) {
          shipment := e.shipment
          route := e.route
        }
      }
      workflow Dispatch transactional {
        create(reference: string, route: Outer) {
          let s = Shipment.create({ reference: reference, route: route })
        }
      }
      commandHandler Plan(reference: string, route: Outer): Shipment id {
        let s = Shipment.create({ reference: reference, route: route })
        return s.id
      }
    }
  }
  api FreightApi from Freight {
    route POST "/plans" -> Routing.Plan
  }
  storage primary { type: postgres }
  resource routingState { for: Routing, kind: state, use: primary }
  deployable d {
    platform: ${platform}
    contexts: [Routing]
    dataSources: [routingState]
    serves: FreightApi
    port: 4000
  }
}
`;

/** The line a declaration starts on, or -1. */
function lineOf(src: string, re: RegExp): number {
  return src.split("\n").findIndex((l) => re.test(l));
}

const ROWS = [
  {
    platform: "node",
    local: /^const OuterSchema = /,
    root: /^const UnLocodeSchema = /,
    // One file per schema-emitting builder: routes, workflows, folded
    // projections, explicit handlers.
    files: [
      "d/http/freightApi-routes.ts",
      "d/http/projections.ts",
      "d/http/shipment.routes.ts",
      "d/http/workflows.ts",
    ],
  },
  {
    platform: "python",
    local: /^class Outer\b/,
    root: /^class UnLocode\b/,
    files: ["d/app/domain/value_objects.py", "d/app/http/wire_models.py"],
  },
] as const;

describe("a root-level value object is declared before the context-local VO that uses it", () => {
  for (const row of ROWS) {
    it(`${row.platform}: every file declaring both orders them by dependency`, async () => {
      const files = await generateSystemFiles(SRC(row.platform));
      const declaring = [...files.keys()]
        .filter((k) => lineOf(files.get(k)!, row.local) >= 0)
        .sort();
      // Vacuity guard: the model must still reach every emitting site, or an
      // ordering regression at the site it stopped reaching would pass here.
      expect(declaring, `${row.platform}: the files that declare the local VO`).toEqual([
        ...row.files,
      ]);
      for (const k of declaring) {
        const src = files.get(k)!;
        const root = lineOf(src, row.root);
        const local = lineOf(src, row.local);
        expect(root, `${k}: the root-level VO is not declared at all`).toBeGreaterThanOrEqual(0);
        expect(
          root,
          `${k}: the root-level VO is declared AFTER the context-local VO that references it`,
        ).toBeLessThan(local);
      }
    });
  }
});

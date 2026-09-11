// Cross-backend gate for row `F2-CB-C7-domainservice-in-requires-guard`.
//
// A `requires` authorization gate is HOISTED out of the operation body to the
// CALLER (`src/ir/util/op-gates.ts`) — so it renders into the route / service
// module while every import collector in that module was derived from the
// operation BODIES the gate had just been lifted out of.  A `domainService`
// call inside such a gate therefore named a symbol the hosting file never
// imported, on four of the five backends, from `.ddd` that parses, validates
// and generates clean:
//
//   | backend | call rendered            | import needed                                |
//   |---------|--------------------------|----------------------------------------------|
//   | dotnet  | `Rules.Fee(...)`         | `using D.Domain.Services;`                   |
//   | node    | `Rules.fee(...)`         | `import { Rules } from "../domain/services"` |
//   | java    | `Rules.fee(...)`         | `import com.loom.d.domain.services.*;`       |
//   | python  | `fee(...)`               | `from app.domain.services.rules import fee`  |
//   | elixir  | fully qualified          | — (nothing to import)                        |
//
// ALL FIVE ARE NOW CORRECT.  This file was the ratchet that kept the gap loud
// while node / java / python sat in other packets' trees; wave C1 packet
// `1e-ledger-backend` closed them, so the `STILL_MISSING` register it carried is
// gone and each row asserts its import POSITIVELY — the same assertion, inverted,
// which is what a closed ratchet looks like.
//
// Each backend's collector now reads `callerGates(agg)` (the ONE enumeration of
// the gates an aggregate hoists, beside the split that creates them) rather than
// re-listing the gate sites locally, so a sixth site cannot reintroduce the
// hole.  The `when` state gates and the find read-gates — which render into the
// same modules and have the same shape — are collected with them.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const SRC = (platform: string) => `
system C7 {
  subdomain S {
    context Ord {
      aggregate Order {
        code: string
        quantity: int = 0
        destroy {
          requires Rules.Fee(quantity) == 0
        }
        operation touch() requires Rules.Fee(quantity) == 0 {
          quantity := quantity + 1
        }
      }
      repository Orders for Order { }
      domainService Rules {
        operation Fee(q: int): int {
          return q
        }
      }
    }
  }
  api OrdApi from S
  storage primary { type: postgres }
  resource ordState { for: Ord, kind: state, use: primary }
  deployable d {
    platform: ${platform}
    contexts: [Ord]
    dataSources: [ordState]
    serves: OrdApi
    port: 4000
  }
}
`;

function bySuffix(files: Map<string, string>, suffix: string): string {
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  if (!key) throw new Error(`no generated file ending in ${suffix}`);
  return files.get(key)!;
}

/** The four backends that render the gate's service call UNQUALIFIED, with the
 *  file that hosts it, the call text proving the site is reached (the VACUITY
 *  GUARD — without it a passing `toContain` could be asserting over a file that
 *  no longer carries the gate at all), and the import that must accompany it. */
const QUALIFIED_BY_IMPORT = [
  {
    platform: "dotnet",
    file: "Application/Orders/Commands/DestroyOrderHandler.cs",
    call: "Rules.Fee(",
    requiredImport: "using D.Domain.Services;",
  },
  {
    platform: "node",
    file: "http/order.routes.ts",
    call: "Rules.fee(",
    requiredImport: 'import { Rules } from "../domain/services";',
  },
  {
    platform: "java",
    file: "features/orders/OrderService.java",
    call: "Rules.fee(",
    requiredImport: "import com.loom.d.domain.services.*;",
  },
  {
    platform: "python",
    file: "app/http/order_routes.py",
    call: "fee(",
    requiredImport: "from app.domain.services.rules import fee",
  },
] as const;

describe("domainService in a `requires` gate — cross-backend import parity", () => {
  it("elixir needs no import — the call leaf is fully qualified", async () => {
    const files = await generateSystemFiles(SRC("elixir"));
    const hit = [...files.values()].find((c) => c.includes("Domain.Services.Rules.fee("));
    expect(hit, "elixir should render the service call fully qualified").toBeDefined();
  });

  for (const row of QUALIFIED_BY_IMPORT) {
    it(`${row.platform} imports the domain service its gate calls`, async () => {
      const files = await generateSystemFiles(SRC(row.platform));
      const host = bySuffix(files, row.file);
      // The gate site is reached — if this fails the fixture drifted, not the fix.
      expect(host, `${row.platform}: gate call site moved`).toContain(row.call);
      expect(
        host,
        `${row.platform}: the gate calls a domainService but ${row.file} does not import it — ` +
          `F2-CB-C7 has regressed on this backend.`,
      ).toContain(row.requiredImport);
    });
  }
});

// A value object nested in a value object (`route: Outer { origin: UnLocode }`)
// is validated at the wire like a top-level one: the request validator walks
// into the rule-less `Outer` so a breach answers the field-invalid 422 with
// pointer `/route/origin/value`, not the domain floor from the constructor.
// The runtime half is the `vo-root-kernel` behavioral case on the java leg.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = `
  valueobject UnLocode {
    value: string
    invariant unLocode5Characters: value.length == 5
  }
  system S {
    subdomain F {
      context R {
        valueobject Outer {
          origin: UnLocode
          destination: UnLocode
        }
        aggregate Shipment with crudish {
          reference: string
          route: Outer
        }
        repository Shipments for Shipment { }
      }
    }
    api A from F
    storage pg { type: postgres }
    resource st { for: R, kind: state, use: pg }
    deployable d {
      platform: java
      contexts: [R]
      dataSources: [st]
      serves: A
      port: 4000
    }
  }
`;

const file = (files: Map<string, string>, suffix: string): string => {
  const hit = [...files.entries()].find(([p]) => p.endsWith(suffix));
  if (!hit) throw new Error(`no generated file ending in ${suffix}`);
  return hit[1];
};

describe("java nested value-object wire validation", () => {
  it("the create validator walks into a rule-less VO that nests a rule-bearing one", async () => {
    const files = await generateSystemFiles(SRC);
    const create = file(files, "/CreateShipmentValidator.java");
    expect(create).toContain('errors.pushNestedPath("route");');
    expect(create).toContain("new OuterValidator(), request.route(), errors");
    const outer = file(files, "/OuterValidator.java");
    expect(outer).toContain('errors.pushNestedPath("origin");');
    expect(outer).toContain("new UnLocodeValidator(), request.origin(), errors");
    expect(outer).toContain("new UnLocodeValidator(), request.destination(), errors");
    expect(file(files, "/UnLocodeValidator.java")).toContain(
      "_system.UnLocode.rule.unLocode5Characters",
    );
  });
});

// `SCALAR_WIRE_JSON` (src/util) is a pure-data mirror of the codec's
// per-primitive `wire.json` (src/ir/enrich/codec.ts) for the typing pass,
// which sits upstream of the IR.  Every row must equal the codec's, and every
// codec primitive must have a row: the mirror cannot drift from the authority.

import { describe, expect, it } from "vitest";
import { allScalarCodecs } from "../../src/ir/enrich/codec.js";
import { SCALAR_WIRE_JSON } from "../../src/util/scalar-wire-json.js";

describe("SCALAR_WIRE_JSON mirrors the codec", () => {
  it.each(
    allScalarCodecs().map((c) => [c.primitive, c.wire.json] as const),
  )("%s crosses the wire as JSON %s", (primitive, json) => {
    expect(SCALAR_WIRE_JSON[primitive]).toBe(json);
  });

  it("has a row for exactly the codec's primitives", () => {
    expect(Object.keys(SCALAR_WIRE_JSON).sort()).toEqual(
      allScalarCodecs()
        .map((c) => c.primitive)
        .sort(),
    );
  });
});

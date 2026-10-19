import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildWireSpec } from "../../src/system/wire-spec.js";
import { buildLoomModel } from "./index.js";
import { sampleWireBody, sampleWireValue, type WireSpecDocument } from "./wire-sample.js";

// The synthesizer is only worth having if it follows the REAL emitted spec, so
// every case here builds the spec through `buildWireSpec` (the function behind
// `.loom/wire-spec.json`) rather than a hand-written schema.

const here = path.dirname(fileURLToPath(import.meta.url));

async function specOf(src: string): Promise<WireSpecDocument> {
  const loom = await buildLoomModel(src);
  return buildWireSpec(loom.systems[0]!);
}

describe("sampleWireBody", () => {
  it("covers every wire-spec vocabulary member, required members only", async () => {
    const spec = await specOf(`
system S {
  subdomain D {
    context C {
      enum Status { Draft, Live }
      valueobject Address { street: string  zip: string? }
      aggregate Other { name: string }
      aggregate Thing {
        title: string
        status: Status
        price: money
        ratio: decimal
        count: int
        ok: bool
        at: datetime
        tags: string[]
        home: Address
        other: Other id
        note: string?
      }
      repository Others for Other { }
      repository Things for Thing { }
    }
  }
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable api { platform: node contexts: [C] dataSources: [st] port: 3000 }
}`);
    expect(sampleWireBody(spec, "Thing")).toEqual({
      id: "00000000-0000-4000-8000-000000000001",
      title: "sample",
      status: "Draft",
      price: "1.00",
      ratio: 1,
      count: 1,
      ok: false,
      at: "2026-01-01T00:00:00.000Z",
      tags: [],
      home: { street: "sample" },
      other: "00000000-0000-4000-8000-000000000001",
      version: 1,
    });
  });

  it("yields exactly the auth-gate fixture's wire members (incl. version)", async () => {
    const src = fs.readFileSync(
      path.join(here, "..", "e2e", "fixtures", "auth-gate-e2e", "auth-gate.ddd"),
      "utf-8",
    );
    const body = sampleWireBody(await specOf(src), "Job");
    expect(Object.keys(body).sort()).toEqual(["id", "status", "title", "version"]);
    expect(body.version).toBe(1);
  });

  it("fails loudly on a schema it cannot satisfy rather than guessing", () => {
    const doc: WireSpecDocument = { system: "S", aggregates: {}, parts: {}, valueObjects: {} };
    expect(() => sampleWireBody(doc, "Missing")).toThrow(/no aggregate 'Missing'/);
    expect(() => sampleWireValue({ type: "string", format: "ipv6" }, doc)).toThrow(
      /unknown string format/,
    );
    expect(() => sampleWireValue({ $ref: "#/valueObjects/Gone" }, doc)).toThrow(/unresolvable/);
    expect(() => sampleWireValue({ type: "object", properties: {}, required: ["x"] }, doc)).toThrow(
      /required member 'x'/,
    );
  });
});

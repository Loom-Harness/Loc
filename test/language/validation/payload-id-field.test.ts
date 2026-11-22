// A `command` or `query` record names the row it acts on by a field called
// `id`; on every other record kind `id` stays the reserved identity word.

import { describe, expect, it } from "vitest";
import { validate } from "../../../src/api/index.js";

const SRC = (kind: string) => `
system S {
  subdomain Sales {
    context Ordering {
      aggregate Order with crudish { code: string }
      repository Orders for Order
      ${kind} Target { id: Order id  note: string }
    }
  }
  storage pg { type: postgres }
  resource st { for: Ordering, kind: state, use: pg }
  deployable d { platform: node contexts: [Ordering] dataSources: [st] port: 4000 }
}`;

async function errors(src: string): Promise<string[]> {
  return (await validate(src)).diagnostics
    .filter((d) => d.severity === "error")
    .map((d) => d.code ?? d.message);
}

describe("an `id` field on a record", () => {
  it.each(["command", "query"])("parses and validates on a %s record", async (kind) => {
    expect(await errors(SRC(kind))).toEqual([]);
  });

  it.each(["payload", "response", "error"])("is refused on a %s record", async (kind) => {
    expect(await errors(SRC(kind))).toContain("loom.payload-id-field");
  });

  it("stays a reserved word on an aggregate field", async () => {
    const src = SRC("command").replace("{ code: string }", "{ id: string  code: string }");
    expect((await errors(src)).length).toBeGreaterThan(0);
  });
});

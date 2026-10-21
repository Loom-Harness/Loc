// `loom.param-default-unsupported` — M-T5.42 item V2.
//
// `param: T = <expr>` parses at every callable site (one shared `Parameter`
// rule), but five lowerers pass `defaults: false` to `lowerCallableParams`: a
// `domainService` operation, a workflow `handle`, a `commandHandler`, a
// `queryHandler` and a `function`.  The default used to vanish between the
// parser and the emitters with `0 error(s)`, so every generated signature still
// required the argument the author thought was optional.  Refused now; the
// sites that DO lower a default (aggregate operation / create / destroy, a
// workflow create) must stay clean.

import { describe, expect, it } from "vitest";
import { parseString } from "../../_helpers/parse.js";

const CODE = "loom.param-default-unsupported";

const sys = (body: string) => `
system Demo {
  subdomain S {
    context C {
      aggregate Thing with crudish {
        name: string
        operation bump(by: int = 1) { }
      }
      repository Things for Thing { }
${body}
    }
  }
}`;

async function codesFor(body: string): Promise<string[]> {
  const { diagnostics } = await parseString(sys(body), { validate: true });
  return diagnostics.map((d) => d.code).filter((c): c is string => c === CODE);
}

describe("loom.param-default-unsupported", () => {
  it.each([
    [
      "a domainService operation",
      `domainService Pricing { operation quote(base: int = 3): int { return base } }`,
    ],
    ["a commandHandler", `commandHandler touch(n: int = 3): int { return n }`],
    ["a queryHandler", `queryHandler peek(n: int = 3): int { return n }`],
    [
      "a workflow handle",
      `workflow flow {
        create(name: string) { }
        handle touch(n: int = 3) { }
      }`,
    ],
  ])("refuses a default on %s", async (_label, body) => {
    expect(await codesFor(body)).toEqual([CODE]);
  });

  it("refuses a default on a `function`", async () => {
    const { diagnostics } = await parseString(
      `context C {
        aggregate Thing {
          name: string
          function twice(x: int = 2): int = x + x
        }
        repository Things for Thing { }
      }`,
      { validate: true },
    );
    expect(diagnostics.map((d) => d.code).filter((c) => c === CODE)).toEqual([CODE]);
  });

  it("leaves the sites that lower a default alone", async () => {
    // The aggregate `bump(by: int = 1)` in the scaffold, plus a workflow create.
    expect(
      await codesFor(`workflow flow {
        create(name: string = "x") { }
      }`),
    ).toEqual([]);
  });
});

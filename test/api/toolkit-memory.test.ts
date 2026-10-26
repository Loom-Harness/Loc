import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { validate } from "../../src/api/index.js";

// Every toolkit `validate()` builds a fresh Langium services instance, and a run
// of AWAITED calls with nothing between them — a census looping over fixtures,
// an agent batch — never yields to the event loop.  Anything that pins a
// services instance only until the microtask queue drains (a `WeakRef.deref()`
// does exactly that) then pins every one of them: the heap grows by the whole
// workspace per call, and a few hundred calls exhaust V8's default heap.
//
// The loop below stays inside one job on purpose (no timer, no I/O) and forces
// a full GC before reading the heap, so retained services are the only thing
// that can grow it.  Measured: ~6 MB retained per call when pinned, well under
// 0.5 MB when collectable.

setFlagsFromString("--expose-gc");
const gc = runInNewContext("gc") as () => void;

const SOURCE = `
system S {
  subdomain Sub { context C {
    aggregate Thing with crudish { name: string }
  } }
  ui WebApp with scaffold(modules: [C]) { }
}`;

describe("toolkit validate() releases its services", () => {
  it("a run of awaited calls does not retain each call's workspace", async () => {
    await validate(SOURCE); // warm module-level caches before the baseline
    gc();
    const before = process.memoryUsage().heapUsed;
    const CALLS = 20;
    for (let i = 0; i < CALLS; i++) await validate(SOURCE);
    gc();
    const perCallMb = (process.memoryUsage().heapUsed - before) / CALLS / 1e6;
    expect(
      perCallMb,
      `each validate() left ${perCallMb.toFixed(2)} MB reachable — something global ` +
        `is holding on to the per-call Langium services`,
    ).toBeLessThan(2);
  }, 180_000); // ~1 s per call alone, several times that on a loaded worker
});

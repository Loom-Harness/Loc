import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { ASYNC_HOOKS_POLYFILL } from "../../web/src/engine/npm/esbuild-vfs-plugin.js";

// The browser preview's `node:async_hooks`: each async chain keeps its own
// AsyncLocalStorage store, as on Node, so a timer tick or consumer running its
// own `run(...)` while a request awaits never swaps the request's context.
//
// The backend bundle lowers async/await (`BACKEND_LOWERED_SYNTAX`); LOWERED is
// that output's shape, with esbuild's `__async` helper verbatim.  NATIVE is
// the same program with a native `await`, which bypasses the Promise patch.
// Each runs in a fresh realm so the polyfill's patches stay there.

const ASYNC_HELPER = `
var __async = (__this, __arguments, generator) => new Promise((resolve, reject) => {
  var fulfilled = (value) => { try { step(generator.next(value)); } catch (e) { reject(e); } };
  var rejected = (value) => { try { step(generator.throw(value)); } catch (e) { reject(e); } };
  var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
  step((generator = generator.apply(__this, __arguments)).next());
});`;

const program = (lowered: boolean): string => {
  const fn = (body: string): string =>
    lowered
      ? `() => __async(void 0, null, function* () { ${body.replaceAll("await ", "yield ")} })`
      : `async () => { ${body} }`;
  return `
${ASYNC_HELPER}
const { AsyncLocalStorage } = module.exports;
const als = new AsyncLocalStorage();
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const chain = (name, ms) => als.run({ name }, ${fn(`
  const seen = [];
  for (let i = 0; i < 3; i++) { await tick(ms); seen.push(als.getStore()?.name); }
  return seen;`)});
const outside = ${fn(`await tick(3); return als.getStore()?.name ?? "none";`)};
const timer = () => new Promise((resolve) =>
  als.run({ name: "timer" }, () => setTimeout(() => resolve(als.getStore()?.name), 4)));
// A query-builder-shaped thenable whose \`then\` reads the context when awaited.
const query = () => ({ then(res) { setTimeout(() => res(als.getStore()?.name), 1); } });
const scoped = (name) => als.run({ name }, ${fn(`await tick(1); return await query();`)});
globalThis.result = Promise.all([chain("request", 2), chain("tick", 3), outside(), timer(), scoped("read")]);
`;
};

async function run(lowered: boolean): Promise<unknown> {
  const sandbox: Record<string, unknown> = {
    setTimeout,
    setInterval,
    queueMicrotask,
    module: { exports: {} },
  };
  runInNewContext(`(() => {\n${ASYNC_HOOKS_POLYFILL}\n})();\n${program(lowered)}`, sandbox);
  return await (sandbox.result as Promise<unknown>);
}

describe("async_hooks polyfill", () => {
  it("keeps each interleaved async chain on its own store", async () => {
    expect(await run(true)).toEqual([
      ["request", "request", "request"],
      ["tick", "tick", "tick"],
      "none",
      "timer",
      "read",
    ]);
  });

  it("needs async/await lowered: a native await bypasses the context", async () => {
    const [request] = (await run(false)) as string[][];
    expect(request).not.toEqual(["request", "request", "request"]);
  });
});

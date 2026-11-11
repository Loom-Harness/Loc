// HEEx coverage — which walker primitives and which `WalkResult` accumulators a
// set of generated systems actually reaches on the Phoenix/HEEx page walker.
//
// It wraps every `heex` renderer in the walker primitive registry, and the
// shared `tsx` renderer of each primitive the shared core renders for HEEx
// (`HEEX_SHARED_PRIMITIVES`) when it runs in a HEEx walk.  Each call counts the
// primitive (and any sub-primitive among its arguments, which the parent
// renders without the registry) and records the HEEx `WalkContext` it renders
// under.  That
// context's accumulators (`handlers`, `formBindings`, the boxed `usesSlot`
// flag, …) are the same objects the walk's `WalkResult` returns, shared by
// reference across every nested context, so reading them after generation
// tells which accumulators the walk filled.  A body with no primitive at all
// fills nothing worth measuring.
//
// `ACCUMULATORS` maps each accumulated `WalkResult` field to the `WalkContext`
// field that backs it (the rendered `heex` and page `titleExpr` are outputs,
// not accumulators).  `test/generator/elixir/heex-coverage.test.ts` pins that
// the map covers every other `WalkResult` field.
//
// Used by `scripts/heex-corpus-diff.mjs coverage` (the whole HEEx corpus) and
// by `heex-coverage.test.ts` (the HEEx showcase fixture alone).

/** `WalkResult` field → the `WalkContext` field that accumulates it. */
export const ACCUMULATORS = {
  handlers: "handlers",
  formBindings: "formBindings",
  queryBindings: "queryBindings",
  actionBindings: "actionBindings",
  usedComponents: "usedComponents",
  componentUses: "componentUses",
  usesSlot: "slotUsed",
  usesChart: "chartUsed",
  usesTableHelpers: "tableHelpersUsed",
  idOptionsBindings: "idOptionsBindings",
  refLabelBindings: "refLabelBindings",
  usedStores: "usedStores",
  uploadBindings: "uploadBindings",
  tableControls: "tableControls",
};

/** Whether an accumulator value holds anything. */
function filled(v) {
  if (v === undefined || v === null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (v instanceof Set || v instanceof Map) return v.size > 0;
  if (typeof v === "object" && "value" in v) return v.value === true;
  return Boolean(v);
}

/**
 * The primitives the HEEx target renders: every registered primitive with a
 * shared renderer, plus the sub-primitives their parents render, less the ones
 * the capability table refuses on LiveView (`DataGrid`).  `uiCapability` is
 * `src/util/target-capabilities.ts`'s, passed in so the script and the test
 * can each import it from where they load the toolchain.
 */
export function heexRenderedPrimitives(registry, uiCapability) {
  const names = new Set();
  for (const [name, def] of Object.entries(registry)) {
    if (!def.tsx && def.group !== "sub") continue;
    if (uiCapability("phoenixLiveView", `primitive:${name}@body`)?.verdict === "refused") continue;
    names.add(name);
  }
  return names;
}

/**
 * Wrap the `tsx` renderer of each primitive in `renderedNames` (the primitives
 * the HEEx target renders) for its calls inside a HEEx walk, and count a
 * sub-primitive (`Column`, `Tab`) in that set as reached when its parent
 * renders it.  Returns a recorder; call `setInput(name)` before generating
 * each input and `report()` after the last one.  `uninstall()` restores the
 * registry.
 */
export function installHeexCoverage(registry, renderedNames) {
  const primitives = new Map(); // name -> Set<input>
  const contexts = []; // { input, ctx }
  const seenRoots = new Set();
  let input = "(unnamed)";
  const originals = new Map(); // name -> original tsx renderer
  const reached = (name, call, ctx) => {
    primitives.get(name).add(input);
    // A sub-primitive is rendered by its parent directly, not through the
    // registry, so it is reached when its parent renders it.
    for (const arg of call.args ?? []) {
      if (arg?.kind === "call" && registry[arg.name]?.group === "sub") {
        primitives.get(arg.name)?.add(input);
      }
    }
    // One record per walk: every nested context shares the root's
    // `handlers` array.
    if (!seenRoots.has(ctx.handlers)) {
      seenRoots.add(ctx.handlers);
      contexts.push({ input, ctx });
    }
  };
  for (const [name, def] of Object.entries(registry)) {
    if (!renderedNames.has(name)) continue;
    primitives.set(name, new Set());
    if (!def.tsx) continue;
    const original = def.tsx;
    originals.set(name, original);
    def.tsx = (call, ctx, depth, slot) => {
      const heex = ctx.sink?.heex;
      if (heex) reached(name, call, heex);
      return original(call, ctx, depth, slot);
    };
  }
  return {
    setInput(name) {
      input = name;
    },
    uninstall() {
      for (const [name, fn] of originals) registry[name].tsx = fn;
    },
    /** `{ primitives, accumulators, componentScoped, maxComponentUses }`, each
     *  mapping a name to the inputs that reached it. */
    report() {
      const accumulators = new Map(Object.keys(ACCUMULATORS).map((k) => [k, new Set()]));
      // The same accumulators, counted only in a stateful component's own body
      // (its state and bindings are hoisted into every host LiveView).
      const componentScoped = new Map(Object.keys(ACCUMULATORS).map((k) => [k, new Set()]));
      let maxComponentUses = 0;
      for (const { input: from, ctx } of contexts) {
        for (const [field, ctxField] of Object.entries(ACCUMULATORS)) {
          if (!filled(ctx[ctxField])) continue;
          accumulators.get(field).add(from);
          if (ctx.stateOwner !== undefined) componentScoped.get(field).add(from);
        }
        for (const n of ctx.componentUses.values())
          maxComponentUses = Math.max(maxComponentUses, n);
      }
      return { primitives, accumulators, componentScoped, maxComponentUses };
    },
  };
}

/** Render a report as text; returns `{ text, gaps }` where `gaps` lists what
 *  no input reached. */
export function formatHeexCoverage(report) {
  const lines = [];
  const gaps = [];
  const row = (label, inputs) => {
    lines.push(`  ${inputs.size === 0 ? "MISSING" : String(inputs.size).padStart(7)}  ${label}`);
    if (inputs.size === 0) gaps.push(label);
  };
  lines.push("primitives the HEEx target renders (inputs reaching each):");
  for (const [name, inputs] of [...report.primitives].sort()) row(name, inputs);
  lines.push("WalkResult accumulators filled:");
  for (const [name, inputs] of report.accumulators) row(name, inputs);
  lines.push("filled inside a stateful component's body:");
  for (const name of ["formBindings", "queryBindings", "uploadBindings", "handlers"]) {
    row(`component:${name}`, report.componentScoped.get(name));
  }
  lines.push(`most invocations of one component in one body: ${report.maxComponentUses}`);
  if (report.maxComponentUses < 2) gaps.push("a component used twice in one body");
  return { text: lines.join("\n"), gaps };
}

// LiveView component-HOISTING collisions — the two shapes `liveview-emit.ts`
// used to `throw` a bare `Error` for, mid-generate, on `.ddd` that `ddd parse`
// had just reported `0 error(s), 0 warning(s)` for.
//
// A HEEx function component is a pure render function: it owns no process.  So
// #2646 lifts a component's `state { … }` into the HOST LiveView's assigns and
// its named `action`s into the host's `handle_event/3` clauses.  That lift is
// what makes components work at all on Phoenix — and it has exactly two places
// where the host cannot hold what two components need at once:
//
//   HANDLER NAME   a LiveView dispatches every `phx-click` BY NAME, so two
//                  `handle_event("bump", …)` clauses hoisted into one module
//                  mean only the first can ever run.  Measured on this tree: a
//                  page `action bump()` plus a rendered component's
//                  `action bump()` →
//                  `Error: platform: elixir — page 'Home' hoists two different
//                  \`bump\` handlers …`, a raw stack trace with no `loom.*`
//                  code.
//
//   STATEFUL REUSE one host assign per component NAME is one cell, so a
//                  component that declares `state` and is rendered twice would
//                  have its two instances share it — React gives each
//                  `<Counter/>` its own `useState`.  Measured: two
//                  `Counter()` calls on one page →
//                  `Error: platform: elixir — page 'Home' renders component
//                  'Counter' 2 times, but 'Counter' declares \`state\``.
//
// Both are model-level facts — which components a page renders, what they
// declare — so they belong at phase ⑦ where the author gets a diagnostic,
// not at codegen where they get a stack trace.  The emitter keeps both throws
// as internal floors naming these codes (`src/ir/` sits below the generator,
// so the generator cannot import this module's verdict; it re-derives it from
// its own walk, which is the stronger arrangement — the two disagree loudly
// rather than silently).
//
// The component-use COUNT is a static scan of `call` expressions naming a
// declared component, which is exactly what the HEEx walker's `componentUses`
// accumulates; the instance total multiplies along the render tree, mirroring
// `assertSingleInstancePerStatefulComponent`.

import { snake } from "../../util/naming.js";
import type { ComponentIR, ExprIR, PageIR, UiIR } from "../types/loom-ir.js";
import { walkExprDeep } from "./walk.js";

/** Component name → how many times `body` renders it, statically.  A nested
 *  render (a component inside a component) is NOT followed here; the caller
 *  multiplies along the tree. */
function componentUses(
  body: ExprIR | undefined,
  declared: ReadonlySet<string>,
): Map<string, number> {
  const out = new Map<string, number>();
  walkExprDeep(body, (e) => {
    if (e.kind !== "call" || !declared.has(e.name)) return;
    out.set(e.name, (out.get(e.name) ?? 0) + 1);
  });
  return out;
}

/** Total instances of every component a body renders, transitively — the
 *  product along the render tree (a component used twice that itself renders a
 *  stateful child yields two of the child).  The `chain` guard keeps the walk
 *  finite on a cyclic component graph (the validator owns cycles separately). */
function totalInstances(
  seed: ReadonlyMap<string, number>,
  byName: ReadonlyMap<string, ComponentIR>,
  declared: ReadonlySet<string>,
): Map<string, number> {
  const total = new Map<string, number>();
  const walk = (uses: ReadonlyMap<string, number>, multiplier: number, chain: string[]): void => {
    for (const [name, n] of uses) {
      const count = n * multiplier;
      total.set(name, (total.get(name) ?? 0) + count);
      if (chain.includes(name)) continue;
      const c = byName.get(name);
      if (c) walk(componentUses(c.body, declared), count, [...chain, name]);
    }
  };
  walk(seed, 1, []);
  return total;
}

/** One page's `snake`-cased handler name declared at two different surfaces. */
export interface LiveViewHandlerCollision {
  page: string;
  /** The `action` name as written (the two spellings collapse under `snake`). */
  handler: string;
  /** Where the two declarations live — `page 'Home'` / `component 'Panel'`. */
  first: string;
  second: string;
}

/** One stateful component rendered more than once on one page. */
export interface LiveViewStatefulReuse {
  page: string;
  component: string;
  count: number;
}

/** Components a page renders, transitively, in a stable order. */
function reachableComponents(
  page: PageIR,
  byName: ReadonlyMap<string, ComponentIR>,
  declared: ReadonlySet<string>,
): string[] {
  const seen = new Set<string>();
  const queue = [...componentUses(page.body, declared).keys()];
  while (queue.length > 0) {
    const name = queue.shift()!;
    if (seen.has(name)) continue;
    seen.add(name);
    const c = byName.get(name);
    if (c) queue.push(...componentUses(c.body, declared).keys());
  }
  return [...seen].sort();
}

/** Every (page, handler-name) pair a LiveView would hoist twice.  One entry per
 *  colliding NAME per page — a name declared at three surfaces reports the
 *  first pair, which is the one the author has to change. */
export function liveViewHandlerCollisions(ui: UiIR): LiveViewHandlerCollision[] {
  const byName = new Map(ui.components.map((c) => [c.name, c]));
  const declared = new Set(byName.keys());
  const out: LiveViewHandlerCollision[] = [];
  for (const page of ui.pages) {
    // site label → the action names it declares, in declaration order.
    const sites: { label: string; actions: readonly { name: string }[] }[] = [
      { label: `page '${page.name}'`, actions: page.actions ?? [] },
    ];
    for (const name of reachableComponents(page, byName, declared)) {
      const c = byName.get(name);
      if (c) sites.push({ label: `component '${c.name}'`, actions: c.actions ?? [] });
    }
    const firstSite = new Map<string, { label: string; name: string }>();
    const reported = new Set<string>();
    for (const site of sites) {
      for (const action of site.actions) {
        // `snake` because the emitter names the clause `snake(action.name)`:
        // `doThing` and `do_thing` are ONE `handle_event` clause.
        const key = snake(action.name);
        const prior = firstSite.get(key);
        if (!prior) {
          firstSite.set(key, { label: site.label, name: action.name });
          continue;
        }
        // Two declarations of the same action name ON ONE SURFACE are a
        // different (page-local) problem and not this gate's; only a
        // cross-surface pair is hoisted into one module here.
        if (prior.label === site.label || reported.has(key)) continue;
        reported.add(key);
        out.push({
          page: page.name,
          handler: prior.name,
          first: prior.label,
          second: site.label,
        });
      }
    }
  }
  return out;
}

/** Every (page, component) pair where a `state`-declaring component is rendered
 *  more than once, so the lift would give the instances one shared cell. */
export function liveViewStatefulReuse(ui: UiIR): LiveViewStatefulReuse[] {
  const byName = new Map(ui.components.map((c) => [c.name, c]));
  const declared = new Set(byName.keys());
  const out: LiveViewStatefulReuse[] = [];
  for (const page of ui.pages) {
    const total = totalInstances(componentUses(page.body, declared), byName, declared);
    for (const [name, count] of [...total.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (count <= 1) continue;
      if ((byName.get(name)?.state.length ?? 0) === 0) continue;
      out.push({ page: page.name, component: name, count });
    }
  }
  return out;
}

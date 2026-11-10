// Every walker target sits on the two frontend axes, and the data-access seam
// binds by them.
//
// `stateHome` × `handlerTopology` (`src/util/frontend-axes.ts`) is what
// per-target behaviour reads instead of a framework name, so each target's
// `axes` must be the table's row for its framework, and the table must name
// exactly the frameworks that have a target.  The data-access seam
// (`_walker/data-access.ts`) is where the axes meet the shared core: a
// client-state target binds a read as a handle the page declares, and a
// server-session target binds it as the in-process context call itself.

import { describe, expect, it } from "vitest";
import {
  bindAccess,
  type DataAccess,
  renderAccessSite,
} from "../../../src/generator/_walker/data-access.js";
import type {
  ApiCallSite,
  DataBinding,
  WalkerTarget,
} from "../../../src/generator/_walker/target.js";
import type { WalkContext } from "../../../src/generator/_walker/walker-core.js";
import { angularTarget } from "../../../src/generator/angular/walker/angular-target.js";
import { heexTarget } from "../../../src/generator/elixir/heex-target.js";
import { felizTarget } from "../../../src/generator/feliz/feliz-target.js";
import { flutterTarget } from "../../../src/generator/flutter/flutter-target.js";
import { tsxTarget } from "../../../src/generator/react/walker/tsx-target.js";
import { svelteTarget } from "../../../src/generator/svelte/walker/svelte-target.js";
import { vueTarget } from "../../../src/generator/vue/walker/vue-target.js";
import { frameworkFacts } from "../../../src/platform/target-facts.js";
import {
  dataAccessOf,
  frameworksWithAxes,
  requireFrontendAxes,
} from "../../../src/util/frontend-axes.js";

/** The site a shell hands `renderDataBindings` for one binding. */
const siteOf = (b: DataBinding): ApiCallSite => ({
  apiHandle: "",
  aggregateName: "",
  operation: "",
  kind: "query",
  args: [],
  varName: b.varName,
  hookName: b.hookName,
  argsRendered: b.argsRendered,
});

const TARGETS: readonly WalkerTarget[] = [
  tsxTarget,
  vueTarget,
  svelteTarget,
  angularTarget,
  flutterTarget,
  felizTarget,
  heexTarget,
];

describe("frontend axes", () => {
  it("every target carries its framework's row, and every row has a target", () => {
    for (const t of TARGETS) expect(t.axes, t.framework).toBe(requireFrontendAxes(t.framework));
    expect(TARGETS.map((t) => t.framework).sort()).toEqual([...frameworksWithAxes()].sort());
  });

  it("the platform descriptor carries the same row", () => {
    for (const fw of frameworksWithAxes()) {
      expect(frameworkFacts(fw)?.axes, fw).toBe(requireFrontendAxes(fw));
    }
  });

  it("places the targets on three of the four combinations", () => {
    const placed = Object.fromEntries(
      TARGETS.map((t) => [t.framework, `${t.axes.stateHome}/${t.axes.handlerTopology}`]),
    );
    expect(placed).toEqual({
      react: "client/inline",
      vue: "client/inline",
      svelte: "client/inline",
      angular: "client/inline",
      flutter: "client/inline",
      feliz: "client/hoisted",
      phoenixLiveView: "server-session/hoisted",
    });
  });

  it("derives data access from the state home", () => {
    for (const t of TARGETS) expect(t.axes.dataAccess).toBe(dataAccessOf(t.axes.stateHome));
    expect(dataAccessOf("client")).toBe("http-client");
    expect(dataAccessOf("server-session")).toBe("in-process");
  });
});

describe("data-access seam", () => {
  const allOrders: DataAccess = {
    aggregateName: "Order",
    operation: "all",
    args: [],
    kind: "aggregate",
  };

  /** The fields of a walk the seam reads. */
  const walkOn = (target: WalkerTarget, sink?: unknown): WalkContext =>
    ({ target, dataBindings: new Map(), bcByAggregate: new Map(), sink }) as unknown as WalkContext;

  it("a client-state target binds a read as a handle the page declares", () => {
    const ctx = walkOn(tsxTarget);
    const binding = bindAccess(allOrders, ctx, () => "");
    expect(renderAccessSite(allOrders, binding, ctx)).toBe(binding.varName);
    expect([...ctx.dataBindings.keys()]).toEqual([binding.varName]);
    expect(binding.importFrom).toBe("../api/order");
    expect(tsxTarget.renderDataBindings([siteOf(binding)])).toHaveLength(1);
  });

  it("a server-session target binds a read as the in-process context call", () => {
    const heex = {
      contextModuleByAggName: new Map([["Order", "ShopApp.Shop"]]),
      appModule: "ShopApp",
    };
    const ctx = walkOn(heexTarget, { heex });
    const binding = bindAccess(allOrders, ctx, () => {
      throw new Error("the shared expression renderer does not speak Elixir");
    });
    expect(binding.varName).toBe("ShopApp.Shop.list_orders!()");
    expect(renderAccessSite(allOrders, binding, ctx)).toBe("ShopApp.Shop.list_orders!()");
    expect(heexTarget.renderDataBindings([siteOf(binding)])).toEqual([]);
  });
});

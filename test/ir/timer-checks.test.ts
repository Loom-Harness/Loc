// timerSource — IR lowering + IR-level validation (scheduling.md, M-T4.1).
//
// Lowering normalises the cadence to the discriminated `TimerCadenceIR` and
// resolves the for-event's context; the IR checks cover the cross-cutting
// semantics the AST cadence validator can't: infra-emitted event shape,
// single-fire state requirement, and the dead-config unbound warning.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { allContexts } from "../../src/ir/types/loom-ir.js";
import type { LoomDiagnostic } from "../../src/ir/validate/validate.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { buildLoomModel } from "../_helpers/ir.js";
import { parseString } from "../_helpers/parse.js";

const TIMER_CODES = new Set([
  "loom.timer-event-shape",
  "loom.timer-needs-state",
  "loom.timer-source-unbound",
]);

async function timerDiags(source: string): Promise<LoomDiagnostic[]> {
  const { model } = await parseString(source, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model))).filter(
    (d) => d.code !== undefined && TIMER_CODES.has(d.code),
  );
}

// A fully valid reactive timer: a tick carried by a channel, reacted to by an
// event-triggered create correlated by the tick's id.
const VALID = `
system Reaping {
  subdomain Ops {
    context Orders {
      aggregate Sweep { runId: string }
      event SweepTick { sweep: Sweep id, at: datetime }
      event SweepRan  { sweep: Sweep id, at: datetime }
      channel Ticks { carries: SweepTick }
      workflow SweepRun eventSourced {
        sweep: Sweep id
        firedAt: datetime
        create(t: SweepTick) by t.sweep { emit SweepRan { sweep: t.sweep, at: t.at } }
        apply(r: SweepRan) { firedAt := r.at }
      }
    }
  }
  storage pg { type: postgres }
  resource opsState { for: Orders, kind: state, use: pg }
  api A from Ops
  deployable d { platform: node, contexts: [Orders], dataSources: [opsState], serves: A, port: 4000 }
  timerSource sweep { for: SweepTick, cron: "*/5 * * * *" }
}
`;

describe("timerSource IR lowering", () => {
  it("lowers cron and every cadences onto the system, discriminated", async () => {
    const loom = await buildLoomModel(`
      system S {
        subdomain M { context C {
          aggregate A { n: string }
          event Tick { at: datetime }
          event Beat { at: datetime }
        }}
        storage pg { type: postgres }
        resource st { for: C, kind: state, use: pg }
        api Api from M
        deployable d { platform: node, contexts: [C], dataSources: [st], serves: Api, port: 4000 }
        timerSource cronTs { for: Tick, cron: "0 2 * * *" }
        timerSource everyTs { for: Beat, every: 15s }
      }
    `);
    const sys = loom.systems[0];
    expect(sys.timerSources.map((t) => t.name)).toEqual(["cronTs", "everyTs"]);
    expect(sys.timerSources[0].cadence).toEqual({ kind: "cron", cron: "0 2 * * *" });
    expect(sys.timerSources[1].cadence).toEqual({ kind: "every", everyMs: 15_000 });
    // The for-event's declaring context is resolved (drives owner derivation).
    expect(sys.timerSources[0].context).toBe("C");
    expect(sys.timerSources[0].event).toBe("Tick");
  });
});

describe("timerSource IR validation", () => {
  it("accepts a valid reactive timer with no timer diagnostics", async () => {
    expect(await timerDiags(VALID)).toEqual([]);
  });

  it("loom.timer-event-shape: rejects a for-event emitted by domain logic", async () => {
    const src = `
      system S {
        subdomain M { context C {
          aggregate A { n: string  create make() { emit Made { a: id } } }
          event Made { a: A id }
          channel Ch { carries: Made }
          workflow W eventSourced {
            a: A id
            on(m: Made) by m.a { emit Made { a: m.a } }
            apply(m: Made) { a := m.a }
          }
        }}
        storage pg { type: postgres }
        resource st { for: C, kind: state, use: pg }
        api Api from M
        deployable d { platform: node, contexts: [C], dataSources: [st], serves: Api, port: 4000 }
        timerSource t { for: Made, cron: "*/5 * * * *" }
      }
    `;
    const diags = await timerDiags(src);
    expect(diags.some((d) => d.code === "loom.timer-event-shape" && d.severity === "error")).toBe(
      true,
    );
  });

  it("loom.timer-event-shape: warns when the tick has no `at: datetime`", async () => {
    const src = `
      system S {
        subdomain M { context C {
          aggregate A { n: string }
          event NoAt { note: string }
        }}
        storage pg { type: postgres }
        resource st { for: C, kind: state, use: pg }
        api Api from M
        deployable d { platform: node, contexts: [C], dataSources: [st], serves: Api, port: 4000 }
        timerSource t { for: NoAt, cron: "*/5 * * * *" }
      }
    `;
    const diags = await timerDiags(src);
    expect(diags.some((d) => d.code === "loom.timer-event-shape" && d.severity === "warning")).toBe(
      true,
    );
  });

  it("loom.timer-needs-state: errors when no db-backed deployable owns the context", async () => {
    // A react-only deployable hosts no context with a state resource → no owner.
    const src = `
      system S {
        subdomain M { context C {
          aggregate A { n: string }
          event Tick { at: datetime }
        }}
        storage pg { type: postgres }
        api Api from M
        ui Web with scaffold(subdomains: [M]) { }
        deployable web { platform: react, targets: Api, serves: Web, port: 3000 }
        timerSource t { for: Tick, cron: "*/5 * * * *" }
      }
    `;
    const diags = await timerDiags(src);
    expect(diags.some((d) => d.code === "loom.timer-needs-state")).toBe(true);
  });

  it("loom.timer-source-unbound: warns when no workflow reacts to the tick", async () => {
    const src = `
      system S {
        subdomain M { context C {
          aggregate A { n: string }
          event Orphan { at: datetime }
        }}
        storage pg { type: postgres }
        resource st { for: C, kind: state, use: pg }
        api Api from M
        deployable d { platform: node, contexts: [C], dataSources: [st], serves: Api, port: 4000 }
        timerSource orphan { for: Orphan, cron: "@daily" }
      }
    `;
    const diags = await timerDiags(src);
    expect(
      diags.some((d) => d.code === "loom.timer-source-unbound" && d.severity === "warning"),
    ).toBe(true);
  });

  // The tick's consumer lives on ANOTHER deployable.  With a channel carrying
  // the tick it is reachable (the channel-wiring checks own the binding), so
  // the timer is not unbound; without one the tick is in-process only and the
  // warning names the deployables it cannot reach.
  const crossDeployable = (channel: boolean) => `
    system T {
      subdomain Up { context Clock {
        aggregate Run with crudish { label: string }
        repository Runs for Run { }
        event Tick { run: Run id, at: datetime }
        ${channel ? "channel Ticks { carries: Tick }" : ""} } }
      subdomain Down { context Billing {
        aggregate Cut with crudish { at: datetime }
        repository Cuts for Cut { }
        workflow OnTick { run: Run id  create(t: Tick) by t.run { let c = Cut.create(at: t.at) } } } }
      storage pg { type: postgres }
      storage bus { type: redis }
      resource clockState { for: Clock, kind: state, use: pg }
      resource billState { for: Billing, kind: state, use: pg }
      timerSource t { for: Tick, every: 30s }
      ${channel ? "channelSource tb { for: Ticks, use: bus }" : ""}
      deployable up { platform: node contexts: [Clock] dataSources: [clockState] ${channel ? "channels: [tb]" : ""} port: 3000 }
      deployable down { platform: python contexts: [Billing] dataSources: [billState] ${channel ? "channels: [tb]" : ""} port: 3001 }
    }
  `;

  it("loom.timer-source-unbound: silent when the tick's consumer is on another deployable over a channel", async () => {
    const diags = await timerDiags(crossDeployable(true));
    expect(diags.filter((d) => d.code === "loom.timer-source-unbound")).toEqual([]);
  });

  it("loom.timer-source-unbound#unreachable: names the consumer the in-process tick cannot reach", async () => {
    const diags = await timerDiags(crossDeployable(false));
    const unbound = diags.filter((d) => d.code === "loom.timer-source-unbound");
    expect(unbound).toHaveLength(1);
    expect(unbound[0].message).toContain("runs on deployable 'up'");
    expect(unbound[0].message).toContain("(down)");
  });

  it("does not fire timer diagnostics on a timer-free system", async () => {
    const src = `
      system S {
        subdomain M { context C { aggregate A { n: string } }}
        storage pg { type: postgres }
        resource st { for: C, kind: state, use: pg }
        api Api from M
        deployable d { platform: node, contexts: [C], dataSources: [st], serves: Api, port: 4000 }
      }
    `;
    expect(await timerDiags(src)).toEqual([]);
    // sanity: allContexts still resolves (guards a vacuous pass)
    expect(allContexts(await buildLoomModel(src)).length).toBeGreaterThan(0);
  });
});

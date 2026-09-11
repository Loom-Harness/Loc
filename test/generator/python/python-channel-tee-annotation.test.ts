import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

// ---------------------------------------------------------------------------
// M-T6.68 (audit #2864 T6) — the Python channel tee must accept what its own
// factory passes it.
//
// `app/dispatch.py`'s PURE-PRODUCER shape (a deployable that wires a broker
// channel but hosts no reactors) annotated the tee's wrapped dispatcher with
// the concrete `NoopDomainEventDispatcher`:
//
//     def __init__(self, inner: NoopDomainEventDispatcher) -> None: ...
//     …
//     return ChannelTeeDispatcher(RealtimeDispatcher(NoopDomainEventDispatcher()))
//
// A `delivery: broadcast` channel puts the realtime tee in the chain, so the
// argument is a `RealtimeDispatcher` — not a `NoopDomainEventDispatcher`.  The
// file rejected its own construction:
//
//     Argument 1 to "ChannelTeeDispatcher" has incompatible type
//     "RealtimeDispatcher"; expected "NoopDomainEventDispatcher"  [arg-type]
//
// Runtime duck-types fine, so nothing failed at boot — but `mypy --strict` is
// what the generated `pyproject.toml` configures, so a channels-using Python
// backend could never pass its own type check.  The parameter wants the
// `DomainEventDispatcher` PROTOCOL, which is what the saga shape in the same
// emitter already uses.
//
// The end-to-end proof is mypy against the generated project's real
// dependencies (compile tier); this test pins the emitted annotation so the
// narrower one cannot come back without a red fast suite.
// ---------------------------------------------------------------------------

/** A pure producer (no reactor workflow) on a `delivery: broadcast` channel —
 *  the shape whose factory wraps the Noop in the realtime tee. */
const BROADCAST_PRODUCER = `
system PyTee {
  subdomain Sales {
    context Orders {
      aggregate Order {
        customerId: string
        status: string
        operation place() {
          precondition status == "Draft"
          status := "Placed"
          emit OrderPlaced { order: id, at: now() }
        }
      }
      repository Orders for Order { }
      event OrderPlaced { order: Order id, at: datetime }
      channel Lifecycle {
        carries: OrderPlaced
        delivery: broadcast
        retention: ephemeral
      }
    }
  }
  api OrdersApi from Sales
  storage pg { type: postgres }
  storage bus { type: redis }
  resource ordersState { for: Orders, kind: state, use: pg }
  channelSource lifecycleBus { for: Lifecycle, use: bus }
  deployable d {
    platform: python
    contexts: [Orders]
    dataSources: [ordersState]
    channels: [lifecycleBus]
    serves: OrdersApi
    port: 4000
  }
}`;

async function dispatchPy(src: string): Promise<string> {
  const files = await generateSystemFiles(src);
  const entry = [...files.entries()].find(([p]) => p.endsWith("app/dispatch.py"));
  expect(entry, "expected the deployable to emit app/dispatch.py").toBeDefined();
  return entry?.[1] ?? "";
}

describe("Python channel tee — the wrapped-dispatcher annotation (M-T6.68)", () => {
  it("annotates the tee's inner dispatcher with the protocol, not the noop", async () => {
    const py = await dispatchPy(BROADCAST_PRODUCER);

    // The tee's parameter takes the protocol every dispatcher in the chain
    // satisfies.
    expect(py).toContain("def __init__(self, inner: DomainEventDispatcher) -> None:");
    // …and the protocol is actually imported, or the annotation is a NameError
    // waiting to happen at import time.
    expect(py).toMatch(/from app\.domain\.events import .*\bDomainEventDispatcher\b/);

    // The narrow annotation is what made the file reject its own construction.
    expect(py).not.toContain("def __init__(self, inner: NoopDomainEventDispatcher) -> None:");
  });

  it("still wraps the realtime tee — the argument the narrow annotation rejected", async () => {
    const py = await dispatchPy(BROADCAST_PRODUCER);

    // Without this, the assertion above would pass vacuously on a shape whose
    // factory happens to pass the Noop directly: the defect only exists because
    // a broadcast channel puts a `RealtimeDispatcher` between the tee and the
    // Noop.  This is the mismatched argument, pinned.
    expect(py).toContain(
      "return ChannelTeeDispatcher(RealtimeDispatcher(NoopDomainEventDispatcher()))",
    );
  });
});

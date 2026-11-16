// Honesty gate for `on <channel>.<Event>` live-event handlers (channels.md
// Part I).  ALL SIX built-in frontends now consume the realtime SSE wire —
// flutter was the last holdout and joined with `generator/flutter/realtime.ts`
// — and ALL FIVE BACKENDS now SERVE it, elixir last
// (`vanilla/realtime-emit.ts`).  So neither half bit a shipped pairing, and
// wave C2 packet 2f DELETED the backend half outright: the
// `#backend-serves-no-sse` arm could not fire from VALID source.  Every
// shipping backend serves the wire, and the only two ways to point a ui at
// something that does not — a frontend deployable with no `targets:`, and one
// targeting another FRONTEND — are already phase-④ errors with better
// messages (`validators/deployable.ts`).  The IR check only ever saw that
// shape because this file parses with `validate: false`; a real `.ddd` is
// stopped two phases earlier.
//
// The two ex-arm cases below are therefore re-pointed rather than deleted:
// each now asserts BOTH halves of the reason the arm went — the phase-④ error
// that makes the shape unreachable, AND that the IR check stays silent on it.
// Asserting only the silence would read the same whether the arm was removed
// or the whole check had stopped working.
//
// What remains of `loom.ui-realtime-unsupported` is the
// `frontend-has-no-consumer` arm: the SEAM a SEVENTH frontend without a
// realtime path would meet.  It warns rather than dropping the handler
// silently, and it is a `seam` row in the register, not a `gap`.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

/** The phase-④ (AST) errors, which this file's other helper deliberately skips.
 *  The deleted `#backend-serves-no-sse` arm's whole justification is that these
 *  fire first on the only shapes that could have reached it, so the claim has to
 *  be measured here rather than asserted in a comment. */
async function astErrors(source: string): Promise<string> {
  const { errors } = await parseString(source, { validate: true });
  return errors.join("\n");
}

async function realtimeWarnings(source: string): Promise<string[]> {
  const { model } = await parseString(source, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model)))
    .filter((d) => d.severity === "warning" && d.code === "loom.ui-realtime-unsupported")
    .map((d) => d.message);
}

// A broadcast channel + an `on` handler on the ui, targeting a backend of the
// given platform from the given frontend: a web framework (rendered by a `web`
// deployable whose ui names it), `feliz`, or `flutter`.
function sys(frontend: string, backendPlatform: string): string {
  const selfHosted = frontend === "feliz" || frontend === "flutter";
  const backendDataSources = backendPlatform === "elixir" ? "" : " dataSources: [st]";
  return `
system RtGate {
  subdomain Shipping {
    context Fulfillment {
      aggregate Order { status: string }
      repository Orders for Order { }
      event OrderPlaced { order: Order id, at: datetime }
      channel Lifecycle { carries: OrderPlaced  delivery: broadcast  retention: ephemeral }
    }
  }
  storage primary { type: postgres }
  resource st { for: Fulfillment, kind: state, use: primary }
  api FulfillmentApi from Shipping
  ui WebApp {
    ${selfHosted ? "" : `framework: ${frontend}`}
    api Fulfillment: FulfillmentApi
    channel Live: Fulfillment.Lifecycle
    on Live.OrderPlaced(e) { toast("order placed") }
    page Home { route: "/" body: Heading { "hi" } }
  }
  deployable backend { platform: ${backendPlatform} contexts: [Fulfillment] serves: FulfillmentApi${backendDataSources} port: 3000 }
  deployable webApp { platform: ${selfHosted ? frontend : "web"} targets: backend ui: WebApp { Fulfillment: backend } port: 3001 }
}
`;
}

describe("ui realtime honesty gate (`loom.ui-realtime-unsupported`)", () => {
  it("does not warn for an SSE frontend on a realtime-serving backend (react → node)", async () => {
    expect(await realtimeWarnings(sys("react", "node"))).toEqual([]);
  });

  it("does not warn for feliz on a realtime-serving backend (feliz → node)", async () => {
    expect(await realtimeWarnings(sys("feliz", "node"))).toEqual([]);
  });

  it("does not warn for angular on a realtime-serving backend (angular → java)", async () => {
    expect(await realtimeWarnings(sys("angular", "java"))).toEqual([]);
  });

  // Vanilla Phoenix emits the SSE stream (`vanilla/realtime-emit.ts`), so an
  // SPA pointed at `platform: elixir` keeps its `on` handler with no warning.
  it("does not warn for react → elixir (vanilla Phoenix serves the SSE wire)", async () => {
    expect(await realtimeWarnings(sys("react", "elixir"))).toEqual([]);
  });

  it("react → web is refused at phase ④, so the IR check never sees it", async () => {
    // `web` IS a frontend platform, so this is the frontend-targets-a-
    // frontend shape — an AST error, not a realtime warning.  Both assertions
    // are load-bearing: the first is why the IR check has no arm for it, the
    // second is that no realtime warning stands in for the AST error.
    expect(await astErrors(sys("react", "web"))).toContain("cannot target another frontend");
    expect(await realtimeWarnings(sys("react", "web"))).toEqual([]);
  });

  it("does not warn for flutter on a realtime-serving backend (flutter → node)", async () => {
    expect(await realtimeWarnings(sys("flutter", "node"))).toEqual([]);
  });

  // …and elixir serves the wire too, so flutter → elixir is clean as well.
  it("does not warn for flutter → elixir (both halves ship)", async () => {
    expect(await realtimeWarnings(sys("flutter", "elixir"))).toEqual([]);
  });

  // The flutter twin of the case above — same phase-④ refusal, asserted
  // separately because flutter reaches the realtime check down a different
  // branch (it is not a static-bundle host) and a single case would not show
  // that.
  it("flutter → web is refused at phase ④ too", async () => {
    expect(await astErrors(sys("flutter", "web"))).toContain("cannot target another frontend");
    expect(await realtimeWarnings(sys("flutter", "web"))).toEqual([]);
  });
});

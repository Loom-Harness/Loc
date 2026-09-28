// M-T1.32 — `toast(<expr>)` inside a page / store / component `action` body.
//
// The twin of `action-navigate.test.ts`, and the second half of the same
// problem: a ui `action` projects to a Riverpod `Notifier` method, a Notifier
// is not in the widget tree, so it has no `BuildContext` and cannot write
// `ScaffoldMessenger.of(context)`.  Before wave C1 packet 1d-ii the statement
// came out as a `// TODO(flutter full-parity)` comment (the button was wired
// and silently did nothing); that packet turned the drop into an honest
// refusal, `loom.flutter-action-body-unsupported#view-effect`; this one builds
// the bridge the refusal was waiting for, so the arm is deleted.
//
// The bridge is Flutter's own supported answer and the same shape `navigate`
// already uses: a `GlobalKey<ScaffoldMessengerState>` handed to `MaterialApp`,
// whose `currentState` is the live messenger (`lib/toast.dart`).  Emission is
// use-driven off one marker, so an app that never toasts from an action stays
// byte-identical.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";
import { dartBracketImbalance } from "./_dart-balance.js";

const SRC = `
system Shop {
  api A from S
  subdomain S { context C {
    aggregate Product { name: string }
    repository Products for Product {}
  } }
  storage db { type: postgres }
  resource st { for: C, kind: state, use: db }
  ui App {
    framework: flutter
    api Shop: A
    page Home {
      route: "/"
      state { n: int = 0 }
      action ping() { n := n + 1  toast("saved") }
      action count() { toast(n) }
      body: Stack { Button { "ping", onClick: ping }, Button { "count", onClick: count } }
    }
  }
  deployable api1 { platform: node contexts: [C] dataSources: [st] serves: A port: 8081 }
  deployable app { platform: flutter targets: api1 ui: App { Shop: api1 } port: 3006 }
}
`;

async function gen(src: string = SRC) {
  const files = await generateSystemFiles(src);
  const pick = (suffix: string) => [...files.entries()].find(([k]) => k.endsWith(suffix))?.[1];
  return { files, pick };
}

describe("flutter toast() in a page action", () => {
  it("shows through the out-of-tree bridge, not through a BuildContext", async () => {
    const { pick } = await gen();
    const page = pick("lib/pages/home_page.dart");
    expect(page, "no home page").toBeDefined();
    expect(page).toContain("showToast('saved');");
    // The pre-fix spellings: the silent comment, and the in-tree form a
    // Notifier cannot write at all.
    expect(page).not.toContain("TODO(flutter full-parity)");
    expect(page).not.toContain("ScaffoldMessenger.of(context)");
    expect(dartBracketImbalance(page!)).toBeUndefined();
  });

  it("renders the message through the SAME emitExpr every other statement uses", async () => {
    // A state read in the argument must resolve to `state.<cell>`, exactly as
    // it would on the right-hand side of a write — the bridge takes `Object?`
    // so a non-string argument coerces instead of failing to compile, which is
    // what the JS frontends get for free.
    const { pick } = await gen();
    expect(pick("lib/pages/home_page.dart")).toContain("showToast(state.n);");
  });

  it("emits lib/toast.dart and imports it from the page that toasts", async () => {
    const { files, pick } = await gen();
    const runtime = pick("lib/toast.dart");
    expect(runtime, "no lib/toast.dart").toBeDefined();
    expect(runtime).toContain("GlobalKey<ScaffoldMessengerState> appScaffoldMessengerKey");
    expect(runtime).toContain("void showToast(Object? message)");
    // Null-safe rather than asserting: `currentState` is null only before the
    // first frame, when no action can have run.
    expect(runtime).toContain("if (messenger == null) return;");
    expect(pick("lib/pages/home_page.dart")).toContain("import '../toast.dart';");
    expect([...files.keys()].some((k) => k.endsWith("lib/toast.dart"))).toBe(true);
  });

  it("installs the scaffoldMessengerKey on MaterialApp", async () => {
    const { pick } = await gen();
    const main = pick("lib/main.dart");
    expect(main).toContain("import 'toast.dart';");
    expect(main).toContain("scaffoldMessengerKey: appScaffoldMessengerKey,");
  });

  it("an app that never toasts from an action emits no bridge and no key", async () => {
    // The emission is use-driven; a non-toasting app must stay byte-identical
    // to the pre-fix output (no stray file, no unused import, no extra
    // `MaterialApp` argument).
    const { files, pick } = await gen(
      SRC.replace('n := n + 1  toast("saved")', "n := n + 1").replace(
        "action count() { toast(n) }",
        "action count() { n := 0 }",
      ),
    );
    expect([...files.keys()].some((k) => k.endsWith("lib/toast.dart"))).toBe(false);
    expect(pick("lib/main.dart")).not.toContain("scaffoldMessengerKey:");
    expect(pick("lib/main.dart")).not.toContain("import 'toast.dart';");
  });

  it("a REALTIME handler's toast stays in-tree and does NOT pull the bridge in", async () => {
    // `LoomRealtime` is a real `ConsumerStatefulWidget` on `MaterialApp.builder`,
    // so it HAS a context.  An in-tree effect should not route through a global
    // key just because an out-of-tree one has to — the two paths reach the same
    // messenger and the difference is only how they find it.
    const { files, pick } = await gen(`
system RtToast {
  subdomain Shipping {
    context Fulfillment {
      aggregate Order { customerId: string }
      repository Orders for Order { }
      event OrderPlaced { order: Order id, at: datetime }
      channel Lifecycle { carries: OrderPlaced  delivery: broadcast  retention: ephemeral }
    }
  }
  storage primary { type: postgres }
  resource st { for: Fulfillment, kind: state, use: primary }
  api FulfillmentApi from Shipping
  ui App {
    framework: flutter
    api Fulfillment: FulfillmentApi
    channel Live: Fulfillment.Lifecycle
    on Live.OrderPlaced(e) { toast("placed") }
    page Home { route: "/" body: Text { "home" } }
  }
  deployable backend {
    platform: node
    contexts: [Fulfillment]
    serves: FulfillmentApi
    dataSources: [st]
    port: 3000
  }
  deployable app {
    platform: flutter
    targets: backend
    ui: App { Fulfillment: backend }
    port: 3006
  }
}
`);
    const rt = pick("lib/realtime.dart");
    expect(rt, "no realtime runtime").toBeDefined();
    expect(rt).toContain("ScaffoldMessenger.maybeOf(context)");
    expect([...files.keys()].some((k) => k.endsWith("lib/toast.dart"))).toBe(false);
  });
});

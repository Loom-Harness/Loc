// The `toast(<msg>)` page effect on React (F3 of the 2026-09-03 language-docs
// audit, packet W1.2 / M-T1.28).
//
// `toast("Draft saved")` in a named `action` body, or in an
// `Action { …, then: … }` slot, renders as a bare `toast(...)` call — the walker
// treats it as an ordinary free call, exactly as it did `navigate(...)` before
// that got its own arm.  React declared the symbol NOWHERE: no import, no
// module, TS2304 in the generated project.
//
// (The REALTIME path — `on <chan>.<Event>(e) { toast(…) }` — was never broken:
// it renders through each pack's `realtime-toast` micro-template into
// `src/components/RealtimeHandlers.tsx`.  That is a different surface and this
// module must not touch it.)

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

async function reactFiles(uiBody: string): Promise<Map<string, string>> {
  return generateSystemFiles(`
    system Demo {
      subdomain S { context C { } }
      ui Web { ${uiBody} }
      deployable api { platform: node, contexts: [C], port: 3000 }
      deployable web { platform: react, targets: api, ui: Web, port: 3001 }
    }
  `);
}

describe("React `toast()` effect", () => {
  it("declares the symbol an action body calls", async () => {
    const files = await reactFiles(`
      page P {
        route: "/p"
        action save() { toast("Draft saved") }
        body: Stack { Button { "Save", onClick: save } }
      }
    `);
    const tsx = files.get("web/src/pages/p.tsx")!;
    // The call the walker emits …
    expect(tsx).toContain('const save = () => { toast("Draft saved"); };');
    // … now resolves against a real module.
    expect(tsx).toContain('import { toast } from "../lib/toast";');
    const mod = files.get("web/src/lib/toast.ts");
    expect(mod).toBeTruthy();
    expect(mod).toContain("export function toast(message: unknown): void {");
    // Self-mounting: no root component has to host a container, because
    // `App.tsx` / `main.tsx` are design-pack templates.
    expect(mod).toContain("document.getElementById(CONTAINER_ID)");
  });

  it("declares it for a COMPONENT action body too", async () => {
    const files = await reactFiles(`
      component Bar() {
        action ping() { toast("hi") }
        body: Stack { Button { "Ping", onClick: ping } }
      }
      page P { route: "/p" body: Bar() }
    `);
    const comp = files.get("web/src/components/Bar.tsx")!;
    expect(comp).toContain('const ping = () => { toast("hi"); };');
    expect(comp).toContain('import { toast } from "../lib/toast";');
  });

  it("declares it for an `Action { …, then: toast(…) }` slot", async () => {
    const files = await generateSystemFiles(`
      system Demo {
        subdomain S { context C {
          aggregate Order { customerId: string
            operation cancel() { customerId := "" } }
          repository Orders for Order { }
        } }
        api DemoApi from S
        storage pg { type: postgres }
        resource cState { for: C, kind: state, use: pg }
        ui Web {
          api Demo: DemoApi
          component OrderPanel(order: Order) {
            body: Stack { Action { order.cancel, then: toast("Cancelled") } }
          }
          page P { route: "/p" body: Stack { Heading { "x", level: 1 } } }
        }
        deployable api { platform: node, contexts: [C], dataSources: [cState], serves: DemoApi, port: 3000 }
        deployable web { platform: react, targets: api, ui: Web { Demo: api }, port: 3001 }
      }
    `);
    const comp = files.get("web/src/components/OrderPanel.tsx")!;
    expect(comp).toContain('.then(() => { toast("Cancelled"); })');
    expect(comp).toContain('import { toast } from "../lib/toast";');
  });

  it("emits neither module nor import when no page reaches the effect", async () => {
    const files = await reactFiles(`
      page P { route: "/p" body: Stack { Heading { "x", level: 1 } } }
    `);
    expect(files.has("web/src/lib/toast.ts")).toBe(false);
    expect(files.get("web/src/pages/p.tsx")!).not.toContain("lib/toast");
  });

  it("leaves the name to a ui that declares its own extern `toast` function", async () => {
    // An extern ui function owns the name — the walker binds its conformance
    // shim, so importing a second `toast` would be a duplicate declaration.
    const files = await reactFiles(`
      function toast(message: string): string extern from "./helpers"
      page P {
        route: "/p"
        action save() { toast("Draft saved") }
        body: Stack { Button { "Save", onClick: save } }
      }
    `);
    // `src/lib/toast.ts` still exists — it is the EXTERN CONFORMANCE SHIM, which
    // lives at exactly that path.  What must not happen is this packet's module
    // landing there and being clobbered by (or clobbering) the shim.
    const mod = files.get("web/src/lib/toast.ts")!;
    expect(mod).toContain("AUTO-GENERATED shim");
    expect(mod).not.toContain("export function toast(message: unknown): void {");
  });
});

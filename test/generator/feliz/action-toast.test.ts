// `toast(…)` in a named action on the Feliz (F#/Elmish) frontend.
//
// Every other frontend renders an action-body `toast("…")`; Feliz's MVU
// `update` had an arm for `navigate` only, so the statement fell to the
// `private-operation` throw and `ddd generate system` crashed on a model
// `ddd parse` accepted.  `update` stays pure: the DOM write runs as a
// `Cmd.ofEffect` after the arm returns its model, through an `updateToast`
// binding declared ahead of `update` — and only when `update` calls it.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const src = (actionBody: string) => `
system T {
  subdomain S { context C { aggregate Note with crudish { title: string } repository Notes for Note { } } }
  api A from S
  ui Web {
    api C: A
    store Cart { state { m: int = 0 } action bump() { m += 1 } }
    page Home {
      route: "/"
      state { n: int = 0  s: string = "" }
      action save() { ${actionBody} }
      body: Stack { Text { s }, Button { "Save", onClick: save } }
    }
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: node contexts: [C] dataSources: [st] serves: A port: 3000 }
  deployable web { platform: feliz targets: api ui: Web { C: api } port: 3001 }
}`;

async function appFs(actionBody: string): Promise<string> {
  const files = await generateSystemFiles(src(actionBody));
  const hit = [...files].find(([p]) => p.endsWith("App.fs"));
  if (!hit) throw new Error("no App.fs emitted");
  return hit[1];
}

describe("feliz: toast(…) in an action", () => {
  it("runs the toast as a Cmd effect after the model update", async () => {
    const app = await appFs('n := n + 1  toast("Saved")');
    expect(app).toContain("let model = { model with N = (model.N + 1) }");
    expect(app).toContain('model, Cmd.ofEffect (fun _ -> updateToast (string ("Saved")))');
  });

  it("batches the toast with a dispatched store action, in statement order", async () => {
    const app = await appFs('toast("Saved")  Cart.bump()');
    expect(app).toContain(
      'Cmd.batch [ Cmd.ofEffect (fun _ -> updateToast (string ("Saved"))); Cmd.ofMsg (CartBump) ]',
    );
  });

  it("reads a state message off the updated model", async () => {
    const app = await appFs("s := s.trim()  toast(s)");
    expect(app).toContain("Cmd.ofEffect (fun _ -> updateToast (string (model.S)))");
  });

  it("declares updateToast ahead of update, and only when update calls it", async () => {
    const app = await appFs('toast("Saved")');
    const decl = app.indexOf("let updateToast (message: string) : unit = Fable.Core.Util.jsNative");
    expect(decl).toBeGreaterThan(-1);
    expect(decl).toBeLessThan(app.indexOf("let update "));
    expect(app).toContain("data-testid','action-toast'");
    expect(await appFs("n := n + 1")).not.toContain("updateToast");
  });
});

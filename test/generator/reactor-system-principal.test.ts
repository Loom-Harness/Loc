// ---------------------------------------------------------------------------
// Item 3 / ruling D1 (docs/decisions.md D-REACTOR-SYSTEM-PRINCIPAL): an event
// reactor that calls a `requires`-gated operation binds the SYSTEM principal
// and evaluates the gate against it — on all five backends.
//
// Before: the `.ddd` below validated `0 error(s)` and generated a reactor that
//   - node:   read an undeclared `currentUser` (tsc TS2304);
//   - .NET:   the same (CS0103);
//   - java:   the same (javac: cannot find symbol);
//   - python: called `o.finish()` with the gate silently DROPPED (fail-open —
//             the dispatcher never looked the operation up);
//   - elixir: called `finish_order(o, %{})`, so the context function's gate
//             read `nil.permissions` and crashed.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { honoProjectDirs, unboundSymbols } from "../_helpers/emitted-binding.js";
import { generateSystemFiles } from "../_helpers/index.js";

const system = (platform: string, gate: string) => `
system S {
  user { id: guid  permissions: string[] }
  subdomain D {
    permissions { close }
    context Ord {
      aggregate Order with crudish {
        code: string
        done: bool
        derived display: string = code
        operation finish() {
          requires ${gate}
          done := true
        }
      }
      repository Orders for Order { }
      event Shipped { order: Order id, at: datetime }
      aggregate Box with crudish {
        label: string
        derived display: string = label
        operation ship(o: Order id) { emit Shipped { order: o, at: now() } }
      }
      repository Boxes for Box { }
      workflow closeOrder {
        orderRef: Order id
        create(e: Shipped) by e.order {
          let o = Orders.getById(e.order)
          o.finish()
        }
      }
    }
  }
  storage primary { type: postgres }
  resource st { for: Ord, kind: state, use: primary }
  deployable api { platform: ${platform}, contexts: [Ord], dataSources: [st], port: 3000, auth: required }
}`;

const GATE = "currentUser.isSystem || currentUser.permissions.contains(permissions.close)";

async function file(platform: string, suffix: string): Promise<string> {
  const files = await generateSystemFiles(system(platform, GATE));
  const hit = [...files.entries()].find(([k]) => k.endsWith(suffix));
  expect(hit, `${suffix} not emitted; got:\n${[...files.keys()].join("\n")}`).toBeDefined();
  return hit![1];
}

describe("reactor binds the system principal (ruling D1)", () => {
  it("node: binds `systemPrincipal()` and every emitted symbol is bound", async () => {
    const files = await generateSystemFiles(system("node", GATE));
    const wf = files.get("api/http/workflows.ts") ?? "";
    expect(wf).toContain("  const currentUser = systemPrincipal();");
    expect(wf).toContain('import { systemPrincipal } from "../auth/middleware";');
    expect(wf).toContain("(currentUser.isSystem === true) ||");
    const mw = files.get("api/auth/middleware.ts") ?? "";
    expect(mw).toContain("export function systemPrincipal(): User {");
    expect(mw).toContain("    isSystem: true,");
    // Every claim is EMPTY on the system principal — never the dev stub's grant.
    expect(mw).toContain("    permissions: [],");
    for (const dir of honoProjectDirs(files)) expect(unboundSymbols(files, dir)).toEqual([]);
  });

  it("dotnet: binds `User.SystemPrincipal(...)` in the notification handler", async () => {
    const h = await file("dotnet", "CloseOrderStartShippedHandler.cs");
    expect(h).toContain(
      "var currentUser = global::Api.Auth.User.SystemPrincipal(RequestContext.Current?.CurrentUser);",
    );
    expect(h).toContain("currentUser.IsSystem ||");
    const user = await file("dotnet", "Auth/User.cs");
    expect(user).toContain("public static User SystemPrincipal(User? origin)");
    expect(user).toContain("public bool IsSystem { get; init; }");
  });

  it("java: binds `User.systemPrincipal(...)` in the @EventListener", async () => {
    const d = await file("java", "OrdDispatcher.java");
    expect(d).toContain(
      "var currentUser = User.systemPrincipal(CurrentUserAccessor.currentOrNull());",
    );
    expect(d).toContain("import com.loom.api.auth.User;");
    expect(d).toContain("import com.loom.api.auth.CurrentUserAccessor;");
    expect(d).toContain("currentUser.isSystem() ||");
  });

  it("python: binds `system_principal()` and KEEPS the operation's gate", async () => {
    const d = await file("python", "app/dispatch.py");
    expect(d).toContain("    current_user = system_principal()");
    expect(d).toContain("from app.auth.user import system_principal");
    // The gate the route enforces is enforced here too — it was dropped before.
    expect(d).toContain(
      'raise ForbiddenError("Forbidden: currentUser.isSystem || currentUser.permissions.contains(permissions.close)")',
    );
    expect(d).toContain("from app.domain.errors import ForbiddenError");
  });

  it("elixir: binds `system_principal/0` and threads it to the gated context fn", async () => {
    const s = await file("elixir", "close_order/start_shipped.ex");
    expect(s).toContain("current_user = ApiWeb.Auth.system_principal()");
    expect(s).toContain("Api.Ord.finish_order(o, %{}, current_user)");
    const auth = await file("elixir", "api_web/auth.ex");
    expect(auth).toContain("def system_principal do");
    expect(auth).toContain("Process.put(:loom_current_user, user)");
  });

  it("a reactor that never reads the principal binds nothing", async () => {
    const files = await generateSystemFiles(system("node", 'this.code != ""'));
    expect(files.get("api/http/workflows.ts") ?? "").not.toContain("systemPrincipal");
  });
});

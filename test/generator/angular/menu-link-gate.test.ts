// Menu-link hiding on Angular (D-AUTH-OIDC, UI gate — nav side).  When an
// `auth: ui` Angular frontend has a sidebar nav link to a page carrying a
// currentUser-only `requires` gate, the app-shell `@if`-hides that link at
// runtime when the gate fails — the nav-side mirror of the page body guard
// (page-requires-gate).  The session user is injected only when a link is
// actually gated, so an `ng build` strict run sees no unused member.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SYS = (opts: { authUi: boolean; gate: string }) => `
system Helpdesk {
  user { id: string role: string permissions: string[] }
  auth {
    enforcement: opt
    provider: keycloak
    oidc { issuer: env("OIDC_ISSUER") clientId: env("OIDC_CLIENT_ID") }
  }
  subdomain Support {
    context Tickets {
      aggregate Ticket with crudish { subject: string }
      repository Tickets for Ticket { }
    }
  }
  storage primary { type: postgres }
  resource st { for: Tickets, kind: state, use: primary }
  api SupportApi from Support
  deployable api { platform: node contexts: [Tickets] serves: SupportApi dataSources: [st] port: 8080 auth: required }
  ui WebApp {
    page Secret {
      route: "/secret"
      ${opts.gate}body: Heading { "Top secret" }
    }
    page Public {
      route: "/public"
      body: Heading { "public" }
    }
  }
  deployable web { platform: angular targets: api ui: WebApp port: 3004${opts.authUi ? " auth: ui" : ""} }
}
`;

function find(files: Map<string, string>, suffix: string): string {
  for (const [k, v] of files) if (k.endsWith(suffix)) return v;
  throw new Error(`no file ending ${suffix}`);
}

describe("angular menu-link gate", () => {
  it("injects SessionService + currentUser accessor and @if-wraps the gated nav link", async () => {
    const shell = find(
      await generateSystemFiles(
        SYS({ authUi: true, gate: 'requires currentUser.role == "manager"\n      ' }),
      ),
      "web/src/app/app.component.ts",
    );
    // The app shell injects the root session service + exposes a currentUser
    // accessor the template reads as bare member refs.
    expect(shell).toContain('import { Component, inject } from "@angular/core";');
    expect(shell).toContain('import { SessionService } from "./auth/session.service";');
    expect(shell).toContain("readonly session = inject(SessionService);");
    expect(shell).toContain(
      "get currentUser(): Record<string, any> { return this.session.user() ?? {}; }",
    );
    // Secret (gated) link is wrapped; Public (ungated) link is not.
    // The gate holds only once the session has loaded: the shell renders outside
    // the auth gate, so before `/auth/me` resolves `currentUser` is `{}`.  Run
    // the emitted condition in both states.
    const cond = /@if \((session\.user\(\) != null && \(.*?\))\) \{ <a mat-list-item/.exec(
      shell,
    )?.[1];
    expect(cond).toBeDefined();
    const run = (user: Record<string, unknown> | null): unknown =>
      new Function("session", "currentUser", `return ${cond};`)({ user: () => user }, user ?? {});
    expect(run(null)).toBe(false);
    expect(run({ role: "manager" })).toBe(true);
    expect(run({ role: "clerk" })).toBe(false);
    expect(shell).toContain('routerLink="/secret"');
    expect(shell).toContain('routerLink="/public"');
    // Exactly one nav link is gated.  Counted on the GATE shape, not on bare
    // `@if`: the shell now always carries one more `@if` for the root
    // error-handler banner (M-T1.8), which has nothing to do with nav gating.
    expect(shell.match(/@if \(session\.user\(\) != null/g)?.length ?? 0).toBe(1);
  });

  it("a permission-gated link stays hidden, without throwing, until the session loads", async () => {
    const shell = find(
      await generateSystemFiles(
        SYS({
          authUi: true,
          gate: 'requires currentUser.permissions.contains("tickets.read")\n      ',
        }),
      ),
      "src/app/app.component.ts",
    );
    const cond = /@if \((.*?)\) \{ <a mat-list-item/.exec(shell)?.[1];
    expect(cond).toBeDefined();
    const run = (user: Record<string, unknown> | null): unknown =>
      new Function("session", "currentUser", `return ${cond};`)({ user: () => user }, user ?? {});
    // Before `/auth/me` resolves the shell's `currentUser` is `{}`.
    expect(run(null)).toBe(false);
    expect(run({ permissions: ["tickets.read"] })).toBe(true);
    expect(run({ permissions: [] })).toBe(false);
  });

  it("rejects a gated link without auth: ui (the silent drop is closed)", async () => {
    // This used to assert the output emitted UNGUARDED — an access check
    // declared in the model and silently absent from the output.  Phase ⑦
    // now refuses the model instead (`requires` joined the currentUser-read
    // placements), so the unguarded output is output no user can obtain.
    await expect(
      generateSystemFiles(
        SYS({ authUi: false, gate: 'requires currentUser.role == "manager"\n      ' }),
      ),
    ).rejects.toThrow("loom.current-user-needs-auth-ui");
  });

  it("emits no gating when no nav link is gated (no page requires)", async () => {
    const shell = find(
      await generateSystemFiles(SYS({ authUi: true, gate: "" })),
      "web/src/app/app.component.ts",
    );
    // The session is still injected — the toolbar's Sign out control reads
    // it — but no nav gate binds `currentUser`.
    expect(shell).toContain("readonly session = inject(SessionService);");
    expect(shell).not.toContain("currentUser");
    // No NAV gate.  (A bare `not.toContain("@if")` would now also forbid the
    // root error-handler banner, which every shell carries — M-T1.8.)
    expect(shell).not.toContain("@if (currentUser");
    // `inject` is unconditional now: the shell injects `LoomErrorHandler`.
    expect(shell).toContain('import { Component, inject } from "@angular/core";');
  });
});

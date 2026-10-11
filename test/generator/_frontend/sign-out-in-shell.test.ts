// `auth: ui` Sign out placement.  The AuthGate (pack-agnostic, inline styles)
// renders no Sign out control: a `position: fixed` overlay would sit on top of
// table rows and form buttons on every page.  Each design pack's app shell
// owns the control instead, in its header / toolbar / sidebar, so it is laid
// out WITH the chrome rather than over the content.
//
// Pinned for every built-in pack on all four static-bundle frontends: the
// shell renders `data-testid="sign-out"` wired to the session's sign-out, the
// gate carries no fixed overlay, and a non-auth app's shell carries neither
// the control nor its import.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const SYSTEM = (platform: string, design: string, authUi: boolean) => `
system Helpdesk {
  user { id: string role: string }
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
  ui WebApp with scaffold(subdomains: [Support]) { }
  deployable web { platform: ${platform} targets: api ui: WebApp port: 3001 design: "${design}"${authUi ? " auth: ui" : ""} }
}
`;

interface Case {
  platform: string;
  design: string;
  shell: string;
  gate: string;
  /** The shell's sign-out handler binding. */
  handler: string;
}

const CASES: Case[] = [
  ...["mantine", "mantine@v7", "mui", "mui@v5", "chakra", "chakra@v2", "shadcn", "shadcn@v3"].map(
    (design) => ({
      platform: "react",
      design,
      shell: "web/src/App.tsx",
      gate: "web/src/auth/AuthGate.tsx",
      handler: "onClick={signOut}",
    }),
  ),
  ...["vuetify", "shadcnVue"].map((design) => ({
    platform: "vue",
    design,
    shell: "web/src/App.vue",
    gate: "web/src/auth/AuthGate.vue",
    handler: '@click="signOut"',
  })),
  ...["shadcnSvelte", "flowbite"].map((design) => ({
    platform: "svelte",
    design,
    shell: "web/src/routes/(app)/+layout.svelte",
    gate: "web/src/lib/auth/AuthGate.svelte",
    handler: "onclick={signOut}",
  })),
  ...["angularMaterial", "primeng", "spartanNg"].map((design) => ({
    platform: "angular",
    design,
    shell: "web/src/app/app.component.ts",
    gate: "web/src/app/auth/auth-gate.component.ts",
    handler: '(click)="session.signOut()"',
  })),
];

function file(files: Map<string, string>, path: string): string {
  const v = files.get(path);
  if (v === undefined) throw new Error(`no file ${path}`);
  return v;
}

describe("auth: ui — Sign out lives in the app shell, not over the page", () => {
  it.each(CASES)("$platform/$design", async (c) => {
    const files = await generateSystemFiles(SYSTEM(c.platform, c.design, true));
    const shell = file(files, c.shell);
    const control = shell.split("\n").find((l) => l.includes('data-testid="sign-out"'));
    expect(control, `${c.shell} renders no sign-out control`).toBeDefined();
    expect(control).toContain(c.handler);
    expect(control).toContain("Sign out");

    const gate = file(files, c.gate);
    expect(gate).not.toMatch(/position:\s*"?fixed/);
    expect(gate).not.toContain("Sign out");
  });

  it.each(CASES)("$platform/$design without auth: ui has no sign-out", async (c) => {
    const files = await generateSystemFiles(SYSTEM(c.platform, c.design, false));
    const shell = file(files, c.shell);
    expect(shell).not.toContain("sign-out");
    expect(shell).not.toContain("signOut");
    expect(files.has(c.gate)).toBe(false);
  });
});

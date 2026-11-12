// The session view of the React / Vue / Svelte / Angular frontends (the
// loading state and the sign-in screen of the generated `AuthGate`) reads the
// shared chrome catalog under i18n, and stays literal English when the app
// ships no translation runtime.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const SYS = (platform: string, auth: string, heading: string) => `
system Helpdesk {
  user { id: string  role: string }
  auth { provider: keycloak oidc { issuer: env("OIDC_ISSUER") clientId: env("OIDC_CLIENT_ID") } }
  subdomain Support {
    context Tickets {
      aggregate Ticket { subject: string }
      repository Tickets for Ticket
      policy { read Ticket requires true }
    }
  }
  storage primary { type: postgres }
  resource st { for: Tickets, kind: state, use: primary }
  api SupportApi from Support
  deployable api { platform: node contexts: [Tickets] serves: SupportApi dataSources: [st] port: 8080 auth: required }
  ui WebApp {
    api Support: SupportApi
    page Home {
      route: "/"
      body: Stack { ${heading} }
    }
  }
  deployable web { platform: ${platform} targets: api ui: WebApp { Support: api } port: 3001 ${auth} }
}`;

const TARGETS = [
  { platform: "react", gate: "web/src/auth/AuthGate.tsx", t: 'import { t } from "../i18n";' },
  { platform: "vue", gate: "web/src/auth/AuthGate.vue", t: 'import { t } from "../lib/locale";' },
  {
    platform: "svelte",
    gate: "web/src/lib/auth/AuthGate.svelte",
    t: 'import { t } from "$lib/locale.svelte";',
  },
  {
    platform: "angular",
    gate: "web/src/app/auth/auth-gate.component.ts",
    t: 'import { t } from "../../lib/locale";',
  },
] as const;

const SIGN_IN = 't("chrome.signIn", "Sign in")';
const LOADING = 't("chrome.sessionLoading", "Loading…")';

describe("session view chrome", () => {
  for (const { platform, gate, t } of TARGETS) {
    it(`${platform}: reads the catalog keys, and the catalog carries them only when gated`, async () => {
      const on = await generateSystemFiles(SYS(platform, "auth: ui", 'Heading { "Helpdesk" }'));
      const view = on.get(gate)!;
      expect(view).toContain(t);
      expect(view).toContain(SIGN_IN);
      expect(view).toContain(LOADING);
      expect(view).not.toMatch(/>\s*Sign in\s*</);
      expect(view).not.toMatch(/>\s*Loading…\s*</);
      const catalog = JSON.parse(on.get(".loom/messages.en.json")!);
      expect(catalog["chrome.signIn"]).toBe("Sign in");
      expect(catalog["chrome.sessionLoading"]).toBe("Loading…");
      expect(catalog["chrome.forbiddenTitle"]).toBe("Forbidden");
      expect(catalog["chrome.forbiddenBody"]).toBe("You do not have access to this page.");

      const off = JSON.parse(
        (await generateSystemFiles(SYS(platform, "", 'Heading { "Helpdesk" }'))).get(
          ".loom/messages.en.json",
        )!,
      );
      expect(off["chrome.signIn"]).toBeUndefined();
      expect(off["chrome.sessionLoading"]).toBeUndefined();
      expect(off["chrome.forbiddenTitle"]).toBeUndefined();
    });

    it(`${platform}: stays literal English when the app has no translation runtime`, async () => {
      const files = await generateSystemFiles(SYS(platform, "auth: ui", ""));
      const view = files.get(gate)!;
      expect(view).not.toContain("chrome.signIn");
      expect(view).toContain("Sign in");
      expect(view).toContain("Loading…");
    });
  }
});

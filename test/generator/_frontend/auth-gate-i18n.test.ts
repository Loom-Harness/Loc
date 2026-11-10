// The Flutter and Feliz session gate (sign-in prompt, forbidden view) and the
// Flutter app-bar title read the catalog under i18n: the chrome keys reach the
// per-app runtime catalog and the system `.loom/messages.en.json`, and the
// emitted widgets look them up instead of spelling English.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const SYS = (platform: "flutter" | "feliz", auth: string) => `
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
      title: "Helpdesk home"
      body: Stack { Heading { "Helpdesk", level: 1 } }
    }
    page Admin {
      route: "/admin"
      ${auth ? 'requires currentUser.role == "admin"' : ""}
      body: Stack { Heading { "Admin", level: 1 } }
    }
  }
  deployable web { platform: ${platform} targets: api ui: WebApp { Support: api } port: 3001 ${auth} }
}`;

const AUTH_KEYS = [
  "chrome.signIn",
  "chrome.notSignedIn",
  "chrome.forbiddenTitle",
  "chrome.forbiddenBody",
];

describe("session gate chrome is catalogued", () => {
  it("joins the system catalog for a gated flutter/feliz ui, and only then", async () => {
    for (const platform of ["flutter", "feliz"] as const) {
      const on = JSON.parse(
        (await generateSystemFiles(SYS(platform, "auth: ui"))).get(".loom/messages.en.json")!,
      );
      for (const k of AUTH_KEYS) expect(on[k], `${platform} ${k}`).toBeDefined();
      const off = JSON.parse(
        (await generateSystemFiles(SYS(platform, ""))).get(".loom/messages.en.json")!,
      );
      for (const k of AUTH_KEYS) expect(off[k], `${platform} ungated ${k}`).toBeUndefined();
    }
  });
});

describe("flutter", () => {
  it("looks the gate text up through t()", async () => {
    const files = await generateSystemFiles(SYS("flutter", "auth: ui"));
    const auth = files.get("web/lib/auth.dart")!;
    expect(auth).toContain("import 'i18n.dart';");
    expect(auth).toContain("Text(t('chrome.signIn', 'Sign in'))");
    expect(auth).toContain("Text(t('chrome.notSignedIn', 'You are not signed in.'))");
    expect(auth).toContain("Text(t('chrome.forbiddenTitle', 'Forbidden')");
    expect(auth).toContain(
      "Text(t('chrome.forbiddenBody', 'You do not have access to this page.'))",
    );
    expect(auth).not.toContain("const Text('Sign in')");
    expect(files.get("web/lib/i18n.dart")!).toContain("'chrome.signIn': 'Sign in'");
  });

  it("titles the app bar from the page's title, not its identifier", async () => {
    const files = await generateSystemFiles(SYS("flutter", "auth: ui"));
    const home = [...files].find(([p]) => p.endsWith("home_page.dart"))![1];
    expect(home).toContain("appBar: AppBar(title: Text(t(");
    expect(home).toContain("Helpdesk home");
    expect(home).not.toContain("AppBar(title: const Text('Home'))");
  });
});

describe("feliz", () => {
  it("looks the gate text up through I18n.t, the prompt by the server's unauthenticated code", async () => {
    const app = (await generateSystemFiles(SYS("feliz", "auth: ui"))).get("web/src/App.fs")!;
    expect(app).toContain('prop.text (I18n.t "chrome.signIn" "Sign in")');
    expect(app).toContain('Html.text (I18n.t "problem.unauthenticated" "Please sign in.")');
    expect(app).toContain('prop.text (I18n.t "chrome.forbiddenTitle" "Forbidden")');
    expect(app).toContain(
      'Html.text (I18n.t "chrome.forbiddenBody" "You do not have access to this page.")',
    );
  });
});

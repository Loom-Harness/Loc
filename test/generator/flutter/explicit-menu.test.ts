// An explicit `menu { }` on the two self-hosting frontends: Flutter mounts it as
// `lib/nav_menu.dart` under every page's app bar, Feliz renders it in place of
// the top-level page list in its navbar.  Both take the section/link layout and
// catalog keys from the shared `deriveSidebarFromUi`, translate an authored
// label through their i18n runtime, and gate a link to a `requires` page on the
// same claims guard the page itself uses.  The runtime half (the gates hide the
// right links for each principal) is `test/behavioral/run-ui-auth.mjs`'s
// menu-gate probes.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = (framework: "flutter" | "feliz") => `
system Desk {
  user { id: string  role: string }
  subdomain Ops { context Work {
    aggregate Job with crudish { title: string }
    repository Jobs for Job { }
  } }
  storage db { type: postgres }
  resource st { for: Work, kind: state, use: db }
  api OpsApi from Ops
  deployable api { platform: node contexts: [Work] serves: OpsApi dataSources: [st] port: 8080 auth: required }
  ui WebApp {
    framework: ${framework}
    api Ops: OpsApi
    page Public { route: "/public" body: Heading { "Public" } }
    page Admin { route: "/admin" requires currentUser.role == "admin" body: Heading { "Admin Area" } }
    menu {
      section "Main" {
        link Public { label: "Home base" },
        link Admin,
        link "Docs" -> "https://example.com/docs"
      }
    }
  }
  deployable web { platform: ${framework} targets: api ui: WebApp { Ops: api } port: 3001 auth: ui }
}
`;

async function emitted(framework: "flutter" | "feliz", path: string): Promise<string> {
  const files = await generateSystemFiles(SRC(framework));
  const hit = [...files].find(([p]) => p.endsWith(path));
  expect(hit, `${path} not emitted`).toBeDefined();
  return hit![1];
}

describe("flutter: an explicit menu renders under every page's app bar", () => {
  it("emits lib/nav_menu.dart with the section, translated label, gate and external link", async () => {
    const menu = await emitted("flutter", "lib/nav_menu.dart");
    expect(menu).toMatch(/Text\(t\('menu\.section\.\w+', 'Main'\)/);
    expect(menu).toMatch(/_navLink\(context, t\('menu\.link\.\w+', 'Home base'\), '\/public'\)/);
    expect(menu).toContain(
      "if (currentUser != null && (currentUser.role == 'admin')) _navLink(context, 'Admin', '/admin'),",
    );
    expect(menu).toContain("final currentUser = ref.watch(sessionProvider).value;");
    expect(menu).toContain("Tooltip(message: 'https://example.com/docs'");
    expect(menu).toContain("Semantics(\n      link: true,");
  });

  it("every page's AppBar mounts it", async () => {
    const page = await emitted("flutter", "lib/pages/public_page.dart");
    expect(page).toContain("import '../nav_menu.dart';");
    expect(page).toContain(
      "appBar: AppBar(title: const Text('Public'), bottom: const LoomNavMenu()),",
    );
  });
});

describe("feliz: an explicit menu replaces the navbar's page list", () => {
  it("renders the section heading, the translated label, the gated link and the external link", async () => {
    const app = await emitted("feliz", "src/App.fs");
    expect(app).toMatch(
      /Html\.li \[ prop\.className "menu-title"; prop\.text \(I18n\.t "menu\.section\.\w+" "Main"\) \]/,
    );
    expect(app).toMatch(
      /Html\.a \[ prop\.href "\/public"; prop\.text \(I18n\.t "menu\.link\.\w+" "Home base"\) \]/,
    );
    expect(app).toContain(
      '(match model.CurrentUser with Some currentUser when currentUser.Role = "admin" -> Html.li [ prop.children [ Html.a [ prop.href "/admin"; prop.text "Admin" ] ] ] | _ -> Html.none)',
    );
    expect(app).toContain(
      'Html.a [ prop.href "https://example.com/docs"; prop.target "_blank"; prop.rel "noopener noreferrer"; prop.text (I18n.t',
    );
  });
});

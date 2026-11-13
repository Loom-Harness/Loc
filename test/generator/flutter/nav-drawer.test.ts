// A ui with no `menu { }` still has navigation: the derived default (the shared
// `deriveSidebarFromUi` over the pages' own `menu { section, label }` metadata)
// renders as a drawer every page's Scaffold mounts, with a Sign out entry under
// `auth: ui`.  Successful writes drop the cached reads they made stale.  The
// runtime half (the drawer opens and navigates; an operation's new state shows
// without a reload) is `test/behavioral/run-ui-flutter.mjs`'s nav + refresh probes.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = (auth: boolean) => `
system Desk {
  user { id: string  role: string }
  subdomain Ops { context Work {
    aggregate Job with crudish { title: string  status: string }
    repository Jobs for Job { }
  } }
  storage db { type: postgres }
  resource st { for: Work, kind: state, use: db }
  api OpsApi from Ops
  deployable api { platform: node contexts: [Work] serves: OpsApi dataSources: [st] port: 8080 ${auth ? "auth: required" : ""} }
  ui WebApp with scaffold(subdomains: [Ops]) {
    framework: flutter
    api Ops: OpsApi
    page Reports { route: "/reports" body: Heading { "Reports" } }
  }
  deployable web { platform: flutter targets: api ui: WebApp { Ops: api } port: 3001 ${auth ? "auth: ui" : ""} }
}
`;

async function emitted(auth: boolean, path: string): Promise<string> {
  const files = await generateSystemFiles(SRC(auth));
  const hit = [...files].find(([p]) => p.endsWith(path));
  expect(hit, `${path} not emitted`).toBeDefined();
  return hit![1];
}

describe("flutter: the derived default navigation is a drawer", () => {
  it("lists Home, the aggregate list pages and custom pages — not New/Detail", async () => {
    const nav = await emitted(false, "lib/nav_menu.dart");
    expect(nav).toContain("class LoomNavDrawer extends StatelessWidget");
    expect(nav).toContain("_navLink(context, 'Home', '/')");
    expect(nav).toMatch(/_navLink\(context, .*'\/jobs'\)/);
    expect(nav).toMatch(/_navLink\(context, .*'Reports'\)?.*'\/reports'\)/);
    expect(nav).not.toContain("/jobs/new");
    expect(nav).not.toContain(":id");
    expect(nav).not.toContain("Sign out");
  });

  it("every page mounts it on its Scaffold", async () => {
    const page = await emitted(false, "lib/pages/job_list_page.dart");
    expect(page).toContain("import '../nav_menu.dart';");
    expect(page).toContain("drawer: const LoomNavDrawer(),");
    expect(page).not.toContain("bottom: const LoomNavMenu()");
  });

  it("under auth: ui ends with a Sign out entry that calls signOut", async () => {
    const nav = await emitted(true, "lib/nav_menu.dart");
    expect(nav).toContain("final currentUser = ref.watch(sessionProvider).value;");
    expect(nav).toContain(
      "if (currentUser != null) const ListTile(title: Text('Sign out'), onTap: signOut),",
    );
  });
});

describe("flutter: a successful write drops the reads it made stale", () => {
  it("reads.dart carries the per-aggregate cache drop", async () => {
    const reads = await emitted(false, "lib/reads.dart");
    expect(reads).toContain(
      "void invalidateReadsIn(ProviderContainer container, [String? aggregate])",
    );
    expect(reads).toMatch(
      /aggregate == 'Job'\) \{\n\s+container\.invalidate\(jobAllProvider\);\n\s+container\.invalidate\(jobByIdProvider\);/,
    );
  });

  it("create, operation and destroy forms drop the aggregate's reads before closing", async () => {
    const forms = await emitted(false, "lib/forms.dart");
    expect(forms).toContain("import 'reads.dart';");
    const drops = forms.match(
      /invalidateReads\(context, 'Job'\);\n\s+Navigator\.of\(context\)\.pop\(\);/g,
    );
    expect(drops?.length).toBeGreaterThanOrEqual(2);
  });
});

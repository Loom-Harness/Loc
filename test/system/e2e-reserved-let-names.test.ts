// A `let` in a `test e2e` body whose name is a TS/JS reserved word (`class`,
// `default`, `new`, …) is valid `.ddd` — and was emitted verbatim, so the
// generated vitest suite / Playwright spec read `const class = …` and failed to
// parse.  Both e2e renderers now route the binding, every `ref` to it, lambda
// params, and the ui renderer's page-handle re-reads through `escapeTsIdent`
// (`class` → `class_`), so the binding and its uses stay one spelling.
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const SRC = `
system KwE2e {
  subdomain Work {
    context Tracking {
      aggregate Ticket with crudish {
        title: string
        estimate: int?
      }
      repository Tickets for Ticket { }
    }
  }
  api TrackingApi from Work
  storage primary { type: postgres }
  resource trackingState { for: Tracking, kind: state, use: primary }
  ui WebApp with scaffold(subdomains: [Work]) {
    api Work: TrackingApi
  }
  deployable d {
    platform: node
    contexts: [Tracking]
    dataSources: [trackingState]
    serves: TrackingApi
    port: 4000
  }
  deployable web {
    platform: react
    targets: d
    ui: WebApp { Work: d }
    port: 3000
  }

  test e2e "reserved let names" against d {
    let class = api.tickets.create({ title: "Ship it" })
    let default = api.tickets.getById(class)
    expect(default.title).toBe("Ship it")
    let new = api.tickets.all()
    expect(new.items.length).toBe(1)
  }

  test e2e "reserved let names in the ui" against web {
    let class = ui.tickets.create({ title: "Ada" })
    let default = ui.tickets.getById(class)
    expect(default.title).toHaveText("Ada")
    expect(class.title).toHaveText("Ada")
  }
}
`;

const RAW_RESERVED =
  /\b(?:const|let)\s+(?:class|default|new)\b|\(\s*(?:class|default|new)\s*\)|\b(?:class|default|new)\.(?:id|title|items|field)\b/;

describe("test e2e let-names that are TS reserved words", () => {
  it("the api vitest suite binds and reads the escaped name", async () => {
    const files = await generateSystemFiles(SRC);
    const spec = [...files].find(([p]) => p.endsWith("e2e/KwE2e.e2e.test.ts"))?.[1];
    expect(spec, "no api e2e spec emitted").toBeDefined();
    expect(spec).toContain("const class_ = await __post(");
    expect(spec).toContain("const default_ = await __get(`${base}/api/tickets/${class_.id}`);");
    expect(spec).toContain("expect(default_.title).toBe(");
    expect(spec).toContain("expect(new_.items.length).toBe(1);");
    // Only the test bodies — the shared wire helpers above them are prose-heavy.
    const body = spec!.slice(spec!.indexOf("describe("));
    expect(body).not.toMatch(RAW_RESERVED);
  });

  it("the Playwright ui spec binds and reads the escaped name", async () => {
    const files = await generateSystemFiles(SRC);
    const spec = [...files].find(([p]) => p.endsWith("e2e/KwE2e.ui.spec.ts"))?.[1];
    expect(spec, "no ui e2e spec emitted").toBeDefined();
    expect(spec).toContain("const class_ = await (async () => {");
    expect(spec).toContain("const default_ = await new TicketDetailPage(page, class_.id).goto();");
    expect(spec).toContain('await expect(default_.field("title")).toHaveText("Ada");');
    // The create-result re-read (`pageHandleExpr`) names the local too.
    expect(spec).toContain('(await new TicketDetailPage(page, class_.id).goto()).field("title")');
    expect(spec).not.toMatch(RAW_RESERVED);
  });
});

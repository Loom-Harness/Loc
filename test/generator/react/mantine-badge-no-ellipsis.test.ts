// Mantine's Badge label is an overflow-hidden grid item, so its min-content is
// zero: in a crowded list table (the scaffold renders every enum column as a
// Badge) the column squeezes "Closed" down to "C…".  Both mantine packs pin the
// Badge root's min width to its content in the theme, so the table scrolls
// instead of ellipsizing a short enum label.  The other packs' badges carry no
// overflow-hidden label and keep their min-content width by construction.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const SYSTEM = (design: string) => `
system Helpdesk {
  subdomain Support {
    context Tickets {
      enum Status { Open, Closed }
      aggregate Ticket with crudish { subject: string status: Status }
      repository Tickets for Ticket { }
    }
  }
  storage primary { type: postgres }
  resource st { for: Tickets, kind: state, use: primary }
  api SupportApi from Support
  deployable api { platform: node contexts: [Tickets] serves: SupportApi dataSources: [st] port: 8080 }
  ui WebApp with scaffold(subdomains: [Support]) { }
  deployable web { platform: react targets: api ui: WebApp port: 3001 design: "${design}" }
}
`;

describe("mantine Badge never ellipsizes a short label", () => {
  it.each(["mantine", "mantine@v7"])("%s theme pins the Badge root min width", async (design) => {
    const files = await generateSystemFiles(SYSTEM(design));
    const theme = files.get("web/src/theme.ts");
    expect(theme, "no web/src/theme.ts").toBeDefined();
    const badge = theme!.split("\n").find((l) => /^\s*Badge:/.test(l));
    expect(badge).toContain('styles: { root: { minWidth: "max-content" } }');
    // The scaffolded list renders the enum column through that Badge.
    expect(files.get("web/src/pages/tickets/list.tsx")).toContain("<Badge");
  });
});

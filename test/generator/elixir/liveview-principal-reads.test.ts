// A LiveView read over a principal-filtered aggregate threads the socket's
// `current_user` into its context function.  Without it every such read bound
// `nil`, pinned the query to `tenant_id = NULL` and answered no rows — a page
// that compiled, rendered, and silently showed nothing.  Each read kind takes
// the actor the way its context function declares it: positionally for the
// list / by-id / find delegates, as the `current_user:` opt for a retrieval's
// `run_<retrieval>_<agg>(args…, opts)`.
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = fs.readFileSync(
  path.resolve(
    here,
    "../../e2e/fixtures/elixir-vanilla-build/vanilla-tenancy-liveview-reads.ddd",
  ),
  "utf8",
);

const liveSrc = (files: Map<string, string>, name: string): string =>
  [...files.entries()].find(([p]) => p.endsWith(`/live/${name}`))?.[1] ?? "";

const ACTOR = "Map.get(socket.assigns, :current_user)";

describe("LiveView reads over a principal-filtered aggregate thread current_user", () => {
  it("list, find, retrieval and by-id each pass the socket's actor", async () => {
    const files = await generateSystemFiles(FIXTURE);
    const list = liveSrc(files, "account_list_live.ex");
    expect(list).toContain(
      `Api.Ledger.run_rich_accounts_account(socket.assigns.rich_accounts_min, current_user: ${ACTOR})`,
    );
    expect(list).toContain(
      `Api.Ledger.by_min_balance_account(socket.assigns.by_min_balance_min, ${ACTOR})`,
    );
    expect(list).toContain(
      `Api.Ledger.list_accounts(socket.assigns.page_num, 10, socket.assigns.sort_key, socket.assigns.sort_dir, ${ACTOR})`,
    );
    const detail = liveSrc(files, "account_detail_live.ex");
    expect(detail).toContain(`Api.Ledger.get_account(socket.assigns.id, ${ACTOR})`);
  });

  it("an aggregate with no principal filter keeps its actor-less calls", async () => {
    const files = await generateSystemFiles(
      FIXTURE.replace("        filter this.tenantId == currentUser.tenantId\n", ""),
    );
    const list = liveSrc(files, "account_list_live.ex");
    expect(list).toContain(
      "Api.Ledger.run_rich_accounts_account(socket.assigns.rich_accounts_min) do",
    );
    expect(list).not.toContain(":current_user)");
  });
});

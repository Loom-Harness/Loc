// The agent's explicit migration flow in the browser: a scripted live-chat
// transport (the `window.__loomAgentComplete` seam) drives the playground's
// host migration tools against the workspace — status shows the unrecorded
// initial schema, a record naming a model the workspace does not hold is
// refused, a bare record writes the chain entry through the Migrations tab's
// path (the strip badge clears), and apply boots the backend so the database
// takes the recorded entry.
//
// The record test is pure client-side.  The apply test bundles and boots, so
// it needs the npm registry and jsdelivr and self-skips without them.

import { expect, type Page, test } from "@playwright/test";
import { browserCanReachNetwork, waitForPlaygroundReady } from "./_helpers";

const OTHER_MODEL = `context Ops {
  aggregate Ticket { subject: string }
}
`;

/** Install a transport that plays `calls` one tool call per turn, then ends. */
async function scriptCalls(
  page: Page,
  calls: { name: string; input: Record<string, unknown> }[],
): Promise<void> {
  await page.evaluate((script) => {
    let turn = 0;
    (window as unknown as { __loomAgentComplete: unknown }).__loomAgentComplete = async () => {
      const call = script[turn];
      turn++;
      if (!call) {
        return { stop_reason: "end_turn", content: [{ type: "text", text: "Migrations handled." }] };
      }
      return {
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: `c${turn}`, name: call.name, input: call.input }],
      };
    };
  }, calls);
}

const card = (page: Page, tool: string) =>
  page.getByTestId("agent-tool-call").filter({ hasText: tool });

async function send(page: Page, text: string, timeout = 60_000): Promise<void> {
  await page.getByTestId("devtools-tab-agent").click();
  await page.getByTestId("agent-input").fill(text);
  await page.getByTestId("agent-send").click();
  await expect(page.getByTestId("agent-chat")).toContainText("Migrations handled.", {
    timeout,
  });
}

test("live chat: status, a refused record, and a record that writes the workspace chain", async ({
  page,
}) => {
  await page.goto("/");
  await waitForPlaygroundReady(page);
  const badge = page.getByTestId("migration-pending");
  await expect(badge).toHaveAttribute("data-initial", "true", { timeout: 60_000 });

  await scriptCalls(page, [
    { name: "loom_migration_status", input: {} },
    { name: "loom_migration_record", input: { source: OTHER_MODEL, name: "initial" } },
    { name: "loom_migration_record", input: { name: "initial" } },
  ]);
  await send(page, "Record the initial migration.");

  await expect(card(page, "loom_migration_status").first()).toContainText("unrecorded step(s)");
  const records = card(page, "loom_migration_record");
  await expect(records).toHaveCount(2);
  await expect(records.nth(0)).toContainText("not the model in the workspace");
  await expect(records.nth(1)).toContainText("recorded 1");

  // The entry is the badge's and the Migrations tab's: the badge clears.
  await expect(badge).toHaveCount(0, { timeout: 60_000 });
});

test("live chat: apply boots the backend and applies the recorded migration", async ({ page }) => {
  test.setTimeout(1_800_000);
  await page.goto("/");
  await waitForPlaygroundReady(page);
  if (!(await browserCanReachNetwork(page))) {
    test.skip(true, "browser cannot reach the npm registry from this environment");
  }

  await scriptCalls(page, [
    { name: "loom_migration_record", input: { name: "initial" } },
    { name: "loom_migration_apply", input: {} },
  ]);
  await send(page, "Record and apply the initial migration.", 900_000);

  await expect(card(page, "loom_migration_record")).toContainText("recorded 1");
  await expect(card(page, "loom_migration_apply")).toContainText("booted, 1 applied", {
    timeout: 600_000,
  });
  // The strip agrees: the backend is booted and nothing is pending.
  await expect(page.getByTestId("btn-boot")).toHaveAttribute("data-state", "ok");
  await expect(page.getByTestId("migration-pending")).toHaveCount(0);
});

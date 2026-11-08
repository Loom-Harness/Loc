import { describe, expect, it } from "vitest";
import type { MigrationStatusReport, RecordMigrationReport } from "../../src/api/index.js";
import { callTool, toolDispatcher, withHostTools } from "../../src/tools/index.js";
import { type AgentMessage, runAgentDemo, TASK_TRACKER_DDD } from "../../web/src/agent/demo.js";
import {
  type ApplyOutcome,
  type MigrationHost,
  migrationHostTools,
} from "../../web/src/agent/host-tools.js";
import { summarizeToolResult } from "../../web/src/agent/live.js";
import { buildSystemPrompt } from "../../web/src/agent/system-prompt.js";
import type { RecordMigrationResult } from "../../web/src/build/protocol.js";

// ---------------------------------------------------------------------------
// The playground's migration host tools: status / record / apply over the
// workspace.  A fake host stands in for App.tsx — it records what each tool
// asked of the workspace, so the tests pin that recording goes through the
// host's `recordMigration` (the Migrations tab's path), that apply runs the
// host's Apply, and that neither acts on a model the workspace does not hold.
// ---------------------------------------------------------------------------

const shop = (fields: string) => `system Shop {
  storage primary { type: postgres }
  resource st { for: Sales, kind: state, use: primary }
  deployable api { platform: node, contexts: [Sales], dataSources: [st] }
  subdomain Selling { context Sales {
    aggregate Order with crudish { ${fields} }
    repository Orders for Order { }
  } }
}
`;

interface FakeHost extends MigrationHost {
  source: string;
  chain: { name: string; content: string }[];
  recorded: { name: string; allowDestructive: boolean }[];
  applies: number;
}

/** A workspace whose `recordMigration` runs the catalog's pure record over
 *  its own source and chain and keeps the files — the same entries the
 *  playground's worker records. */
function fakeHost(source: string, outcome?: ApplyOutcome): FakeHost {
  const host: FakeHost = {
    source,
    chain: [],
    recorded: [],
    applies: 0,
    workspaceSource: () => host.source,
    chainFiles: async () => (host.chain.length > 0 ? host.chain : undefined),
    recordMigration: async (name, allowDestructive): Promise<RecordMigrationResult> => {
      host.recorded.push({ name, allowDestructive });
      const r = (await callTool("loom_migration_record", {
        source: host.source,
        migrations: host.chain.length > 0 ? host.chain : undefined,
        name,
        allowDestructive,
      })) as RecordMigrationReport;
      if (!r.ok) {
        return {
          ok: false,
          diagnostics: r.diagnostics.map((d) => ({
            severity: "error" as const,
            message: d.message,
            code: d.code,
          })),
        };
      }
      host.chain.push(...r.files.map((f) => ({ name: f.name, content: f.content })));
      return {
        ok: true,
        files: r.files.map((f) => ({ path: `/workspace/${f.path}`, content: f.content })),
        diagnostics: [],
      };
    },
    applyMigrations: async () => {
      host.applies++;
      return outcome ?? { kind: "booted", applied: host.chain.map((c) => c.name), head: null };
    },
  };
  return host;
}

describe("playground migration host tools", () => {
  it("status reports the workspace model against the workspace chain", async () => {
    const host = fakeHost(shop("reference: string"));
    const call = toolDispatcher(withHostTools(migrationHostTools(host)));

    const before = (await call("loom_migration_status", {})) as MigrationStatusReport;
    expect(before.unrecorded).toBe(true);
    expect(before.recorded).toBe(false);

    await call("loom_migration_record", { name: "initial" });
    const after = (await call("loom_migration_status", {})) as MigrationStatusReport;
    expect(after.recorded).toBe(true);
    expect(after.unrecorded).toBe(false);
    // An explicit source is reported against the workspace chain too.
    const edited = (await call("loom_migration_status", {
      source: shop("reference: string\n    note: string?"),
    })) as MigrationStatusReport;
    expect(edited.unrecorded).toBe(true);
  });

  it("record writes through the host and needs the destructive acknowledgement", async () => {
    const host = fakeHost(shop("reference: string\n    note: string?"));
    const call = toolDispatcher(withHostTools(migrationHostTools(host)));
    const initial = (await call("loom_migration_record", { name: "initial" })) as {
      ok: boolean;
      written: boolean;
      files: { name: string; path: string }[];
    };
    expect(initial.ok).toBe(true);
    expect(initial.written).toBe(true);
    expect(initial.files.map((f) => f.name)).toEqual([host.chain[0]!.name]);

    host.source = shop("reference: string");
    const refused = (await call("loom_migration_record", { name: "drop-note" })) as {
      ok: boolean;
      needsAcknowledgement: boolean;
    };
    expect(refused.ok).toBe(false);
    expect(refused.needsAcknowledgement).toBe(true);
    expect(host.chain).toHaveLength(1);

    const acked = (await call("loom_migration_record", {
      name: "drop-note",
      allowDestructive: true,
    })) as { ok: boolean };
    expect(acked.ok).toBe(true);
    expect(host.recorded).toEqual([
      { name: "initial", allowDestructive: false },
      { name: "drop-note", allowDestructive: false },
      { name: "drop-note", allowDestructive: true },
    ]);
    expect(host.chain).toHaveLength(2);
  });

  it("record and apply refuse a source the workspace does not hold", async () => {
    const host = fakeHost(shop("reference: string"));
    const call = toolDispatcher(withHostTools(migrationHostTools(host)));
    const candidate = shop("reference: string\n    note: string?");
    await expect(
      call("loom_migration_record", { source: candidate, name: "add-note" }),
    ).rejects.toThrow(/not the model in the workspace/);
    await expect(call("loom_migration_apply", { source: candidate })).rejects.toThrow(
      /not the model in the workspace/,
    );
    expect(host.recorded).toEqual([]);
    expect(host.applies).toBe(0);
    // The workspace's own source (whitespace aside) is accepted.
    await call("loom_migration_record", { source: `${host.source}\n`, name: "initial" });
    expect(host.recorded).toHaveLength(1);
  });

  it("apply runs the host's Apply and reports how it ended", async () => {
    const pending: ApplyOutcome = {
      kind: "pending",
      migration: {
        kind: "unrecorded",
        head: null,
        initial: true,
        modules: ["Selling"],
        steps: 1,
        destructive: false,
      },
      message: "record the migration first",
    };
    const host = fakeHost(shop("reference: string"), pending);
    const call = toolDispatcher(withHostTools(migrationHostTools(host)));
    expect(await call("loom_migration_apply", {})).toEqual(pending);
    expect(host.applies).toBe(1);
  });

  it("the system prompt describes the explicit flow and offers apply only with the host tools", () => {
    const host = fakeHost(shop("reference: string"));
    const withApply = buildSystemPrompt(withHostTools(migrationHostTools(host)));
    expect(withApply).toContain("loom_migration_status");
    expect(withApply).toContain("loom_migration_record");
    expect(withApply).toMatch(/allowDestructive: true`? only when/);
    expect(withApply).toMatch(/- loom_migration_apply: /);
    const catalogOnly = buildSystemPrompt();
    expect(catalogOnly).not.toContain("loom_migration_apply");
    expect(catalogOnly).toContain("migrations/");
  });
});

describe("live chat cards for the migration tools", () => {
  it("summarise status, record and apply results", () => {
    const s = (name: string, v: unknown) => summarizeToolResult(name, JSON.stringify(v));
    expect(s("loom_migration_status", { ok: true, unrecorded: false, modules: [] })).toBe(
      "up to date",
    );
    expect(
      s("loom_migration_status", {
        ok: true,
        unrecorded: true,
        destructive: true,
        modules: [{ unrecordedSteps: 2 }, { unrecordedSteps: 0 }],
      }),
    ).toBe("2 unrecorded step(s), destructive");
    expect(s("loom_migration_record", { ok: true, files: [{}, {}] })).toBe("recorded 2");
    expect(s("loom_migration_record", { ok: false, needsAcknowledgement: true })).toBe(
      "destructive — not recorded",
    );
    expect(s("loom_migration_apply", { kind: "booted", applied: ["a"], head: "a" })).toBe(
      "booted, 1 applied",
    );
    expect(s("loom_migration_apply", { kind: "failed", stage: "bundle", message: "x" })).toBe(
      "failed at bundle",
    );
  });
});

describe("the scripted demo records the initial migration", () => {
  const play = async (
    callTool?: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  ) => {
    let messages: AgentMessage[] = [];
    await runAgentDemo({
      setMessages: (fn) => {
        messages = fn(messages);
      },
      applySource: () => {},
      triggerGenerate: () => {},
      callTool,
      delayMs: 0,
    });
    return messages;
  };

  it("through the host, so the workspace chain holds the entry", async () => {
    const host = fakeHost(TASK_TRACKER_DDD);
    const messages = await play(toolDispatcher(withHostTools(migrationHostTools(host))));
    const tools = messages.flatMap((m) => m.toolCalls ?? []);
    expect(tools.find((t) => t.tool === "loom_migration_status")?.result).toMatch(/unrecorded/);
    expect(tools.find((t) => t.tool === "loom_migration_record")?.result).toBe("recorded 1");
    expect(host.recorded).toEqual([{ name: "initial", allowDestructive: false }]);
    expect(host.chain.map((c) => c.name)).toEqual([expect.stringMatching(/_work_initial\.json$/)]);
    expect(messages.at(-1)?.text).toMatch(/Done/);
  });

  it("skips the record when the chain already records the model", async () => {
    const host = fakeHost(TASK_TRACKER_DDD);
    await play(toolDispatcher(withHostTools(migrationHostTools(host))));
    const again = await play(toolDispatcher(withHostTools(migrationHostTools(host))));
    const tools = again.flatMap((m) => m.toolCalls ?? []);
    expect(tools.find((t) => t.tool === "loom_migration_status")?.result).toBe("up to date");
    expect(tools.some((t) => t.tool === "loom_migration_record")).toBe(false);
    expect(host.recorded).toHaveLength(1);
  });
});

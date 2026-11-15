import { describe, expect, it } from "vitest";
import type {
  DiffReport,
  GenerateReport,
  MigrationStatusReport,
  ModelView,
  Outline,
  PatchResult,
  PrimitiveCatalog,
  RecordMigrationReport,
  SnapshotReport,
  ValidateReport,
} from "../../src/api/index.js";
import { entryFileName, serializeEntry } from "../../src/system/migration-chain.js";
import { callTool, TOOLS, TOOLS_BY_NAME } from "../../src/tools/index.js";
import { recordChain } from "../_helpers/generate.js";

// ---------------------------------------------------------------------------
// The agent-tool catalog (src/tools/, D-AGENT-TOOLS) — the one tool set every
// transport (MCP server, playground chat) shares.  Completeness + dispatch.
// ---------------------------------------------------------------------------

const CLEAN = `context Sales {
  aggregate Order { total: int }
}
`;

const BARE = `context Sales {
  aggregate Order { customer: Customer }
  aggregate Customer { name: string }
}
`;

describe("agent-tool catalog", () => {
  it("every tool is well-formed (loom_ name, description, object inputSchema, handler)", () => {
    expect(TOOLS.length).toBeGreaterThanOrEqual(4);
    for (const t of TOOLS) {
      expect(t.name).toMatch(/^loom_[a-z_]+$/);
      expect(t.description.length).toBeGreaterThan(20);
      expect((t.inputSchema as { type?: string }).type).toBe("object");
      expect(typeof t.handler).toBe("function");
    }
    // names are unique and indexed
    expect(Object.keys(TOOLS_BY_NAME).sort()).toEqual(TOOLS.map((t) => t.name).sort());
  });

  it("loom_validate dispatches to a ValidateReport", async () => {
    const ok = (await callTool("loom_validate", { source: CLEAN })) as ValidateReport;
    expect(ok.ok).toBe(true);
    const bad = (await callTool("loom_validate", { source: BARE })) as ValidateReport;
    expect(bad.ok).toBe(false);
    expect(bad.diagnostics.some((d) => d.code === "loom.bare-aggregate-in-type")).toBe(true);
  });

  it("loom_outline returns the address book", async () => {
    const out = (await callTool("loom_outline", { source: CLEAN })) as Outline;
    expect(out.contexts.find((c) => c.name === "Sales")).toBeDefined();
  });

  it("loom_read_model projects the resolved wire shape a loose context omits from the outline", async () => {
    const mv = (await callTool("loom_read_model", { source: CLEAN })) as ModelView;
    // CLEAN is a loose context (no `system`), so it lands under `contexts`.
    const sales = mv.contexts.find((c) => c.name === "Sales");
    expect(sales).toBeDefined();
    const order = sales?.aggregates.find((a) => a.name === "Order");
    expect(order?.context).toBe("Sales");
    // A loose context is exposed by no deployable, so nothing serves a wire;
    // its members still describe the aggregate: the id token, then the
    // declared `total: int`.
    expect(order?.wire).toEqual([]);
    expect(order?.members.some((f) => f.source === "id")).toBe(true);
    const total = order?.members.find((f) => f.name === "total");
    expect(total?.type).toBe("int");
    expect(total?.source).toBe("property");
  });

  it("loom_read_model's wire is the exposed record; members keep what the wire hides", async () => {
    const source = `system S {
  subdomain M { context Sales { aggregate Order { total: int  note: string internal } } }
  storage pg { type: postgres }
  resource st { for: Sales, kind: state, use: pg }
  deployable api { platform: node contexts: [Sales] dataSources: [st] port: 8080 }
}`;
    const mv = (await callTool("loom_read_model", { source })) as ModelView;
    const order = mv.systems.flatMap((s) => s.aggregates).find((a) => a.name === "Order");
    expect(order?.wire.map((f) => f.name)).toEqual(["id", "total", "rowVersion"]);
    // An `internal` field never crosses the wire, but it is still a member.
    expect(order?.members.map((f) => f.name)).toContain("note");
  });

  it("loom_read_model returns an empty view for a source that can't lower", async () => {
    const mv = (await callTool("loom_read_model", { source: "not a model" })) as ModelView;
    expect(mv).toEqual({ systems: [], contexts: [] });
  });

  it("loom_list_primitives lists the closed walker vocabulary (no args)", async () => {
    const cat = (await callTool("loom_list_primitives", {})) as PrimitiveCatalog;
    expect(cat.layout).toEqual([...cat.layout].sort()); // stable, sorted
    for (const name of ["Stack", "Heading", "Button", "Card", "Field", "Table"]) {
      expect(cat.layout).toContain(name);
    }
    expect(cat.sub).toContain("Tab");
    expect(cat.sub).toContain("Column");
  });

  it("loom_generate reports validation (no system → empty manifest, still ok)", async () => {
    const r = (await callTool("loom_generate", { source: CLEAN })) as GenerateReport;
    expect(r.ok).toBe(true);
    expect(Array.isArray(r.deployables)).toBe(true);
  });

  it("loom_apply_patch applies a node-addressed edit", async () => {
    const r = (await callTool("loom_apply_patch", {
      source: CLEAN,
      patches: [{ op: "add", target: "aggregate Sales.Order", source: "note: string" }],
    })) as PatchResult;
    expect(r.ok).toBe(true);
    expect(r.text).toContain("note: string");
  });

  it("loom_apply_patch renames a declaration and its cross-references", async () => {
    const withRef = `context Sales {
  aggregate Order { customer: Customer id }
  aggregate Customer { name: string }
}
`;
    const r = (await callTool("loom_apply_patch", {
      source: withRef,
      patches: [{ op: "rename", target: "aggregate Sales.Customer", source: "Client" }],
    })) as PatchResult;
    expect(r.ok).toBe(true);
    expect(r.text).toContain("aggregate Client");
    expect(r.text).toContain("customer: Client id");
    expect(r.text).not.toContain("Customer");
  });

  it("the loop composes through the catalog: validate → fix → validate", async () => {
    const before = (await callTool("loom_validate", { source: BARE })) as ValidateReport;
    const patches = before.diagnostics
      .map((d) => d.fixHint?.patch)
      .filter((p): p is NonNullable<typeof p> => p !== undefined);
    const applied = (await callTool("loom_apply_patch", {
      source: BARE,
      patches,
    })) as PatchResult;
    expect(applied.ok).toBe(true);
    const after = (await callTool("loom_validate", { source: applied.text })) as ValidateReport;
    expect(after.ok).toBe(true);
  });

  it("loom_diff surfaces the migration + wire delta a change implies", async () => {
    const v1 = `system Shop {
  storage primary { type: postgres }
  resource st { for: Sales, kind: state, use: primary }
  deployable api { platform: node, contexts: [Sales], dataSources: [st] }
  subdomain Selling { context Sales {
    aggregate Order with crudish { reference: string }
    repository Orders for Order { }
  } }
}
`;
    const v2 = v1.replace("reference: string", "reference: string\n    note: string?");
    const r = (await callTool("loom_diff", { source: v2, baseline: v1 })) as DiffReport;
    expect(r.ok).toBe(true);
    expect(r.hasBaseline).toBe(true);
    expect(r.breaking).toBe(false);
    expect(r.migrations.some((m) => m.steps.some((s) => s.op === "addColumn"))).toBe(true);
    // Omitting the baseline derives the first-run ("Initial") migration.
    const first = (await callTool("loom_diff", { source: v2 })) as DiffReport;
    expect(first.hasBaseline).toBe(false);
    expect(first.migrations.every((m) => m.name === "Initial")).toBe(true);
  });

  it("loom_diff refuses a baseline that does not load instead of reading it as absent", async () => {
    // Mutation-checked: restoring the old "absent baseline" fallthrough makes
    // this answer ok:true, hasBaseline:false, breaking:false.
    const source = `system Shop {
  storage primary { type: postgres }
  resource st { for: Sales, kind: state, use: primary }
  deployable api { platform: node, contexts: [Sales], dataSources: [st] }
  subdomain Selling { context Sales {
    aggregate Order with crudish { reference: string }
    repository Orders for Order { }
  } }
}
`;
    const r = (await callTool("loom_diff", { source, baseline: "garbage{" })) as DiffReport;
    expect(r.ok).toBe(false);
    expect(r.hasBaseline).toBe(true);
    expect(r.breaking).toBe(false);
    expect(r.diagnostics.map((d) => d.code)).toContain("loom.diff-baseline-invalid");
  });

  it("loom_diff takes the committed chain as the schema baseline", async () => {
    const v1 = `system Shop {
  storage primary { type: postgres }
  resource st { for: Sales, kind: state, use: primary }
  deployable api { platform: node, contexts: [Sales], dataSources: [st] }
  subdomain Selling { context Sales {
    aggregate Order with crudish { reference: string }
    repository Orders for Order { }
  } }
}
`;
    const v2 = v1.replace("reference: string", "reference: string\n    note: string?");
    const chain = await recordChain([v1]);
    const migrations = chain.entries.map((e) => ({
      name: entryFileName(e),
      content: serializeEntry(e),
    }));
    const r = (await callTool("loom_diff", { source: v2, migrations })) as DiffReport;
    expect(r.ok).toBe(true);
    expect(r.hasBaseline).toBe(true);
    expect(r.migrations.map((m) => m.steps.map((s) => s.op))).toEqual([["addColumn"]]);

    const broken = (await callTool("loom_diff", {
      source: v2,
      migrations: [{ name: "x.json", content: "<<<<<<<" }],
    })) as DiffReport;
    expect(broken.ok).toBe(false);
    expect(broken.diagnostics.map((d) => d.code)).toContain("loom.migration-chain-invalid");
  });

  describe("loom_migration_status / loom_migration_record", () => {
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
    const record = async (args: Record<string, unknown>) =>
      (await callTool("loom_migration_record", {
        now: "20260301000000",
        ...args,
      })) as RecordMigrationReport;
    const status = async (args: Record<string, unknown>) =>
      (await callTool("loom_migration_status", args)) as MigrationStatusReport;
    const asChain = (r: RecordMigrationReport) =>
      r.files.map((f) => ({ name: f.name, content: f.content }));

    it("a model with no chain is wholly unrecorded and records as each module's Initial", async () => {
      const v1 = shop("reference: string");
      const before = await status({ source: v1 });
      expect(before.ok).toBe(true);
      expect(before.recorded).toBe(false);
      expect(before.unrecorded).toBe(true);
      expect(before.destructive).toBe(false);
      expect(before.modules.map((m) => [m.module, m.head, m.unrecordedSteps > 0])).toEqual([
        ["Selling", undefined, true],
      ]);

      const initial = await record({ source: v1, name: "initial" });
      expect(initial.ok).toBe(true);
      expect(initial.files.map((f) => f.path)).toEqual([
        "migrations/20260301000000_selling_initial.json",
      ]);
      expect(JSON.parse(initial.files[0]!.content).name).toBe("Initial");

      const after = await status({ source: v1, migrations: asChain(initial) });
      expect(after.recorded).toBe(true);
      expect(after.unrecorded).toBe(false);
      expect(after.head).toEqual({
        version: "20260301000000",
        module: "Selling",
        name: "Initial",
      });
      // Nothing changed since the head: an empty recording, still ok.
      const again = await record({ source: v1, migrations: asChain(initial), name: "noop" });
      expect(again.ok).toBe(true);
      expect(again.files).toEqual([]);
    });

    it("a destructive change is refused until it is acknowledged", async () => {
      const v1 = shop("reference: string\n    note: string?");
      const chain = asChain(await record({ source: v1, name: "initial" }));
      const v2 = shop("reference: string");

      const pending = await status({ source: v2, migrations: chain });
      expect(pending.unrecorded).toBe(true);
      expect(pending.destructive).toBe(true);
      expect(pending.modules[0]?.destructiveMessage).toMatch(/destructive/);

      const refused = await record({ source: v2, migrations: chain, name: "drop-note" });
      expect(refused.ok).toBe(false);
      expect(refused.needsAcknowledgement).toBe(true);
      expect(refused.files).toEqual([]);
      expect(refused.diagnostics.map((d) => d.code)).toContain("loom.migration-destructive");

      const acked = await record({
        source: v2,
        migrations: chain,
        name: "drop-note",
        allowDestructive: true,
      });
      expect(acked.ok).toBe(true);
      const entry = JSON.parse(acked.files[0]!.content);
      expect(entry.name).toBe("DropNote");
      expect(entry.allowDestructive).toBe(true);
      expect(entry.steps.map((st: { op: string }) => st.op)).toEqual(["dropColumn"]);
    });

    it("refuses a bad or taken name, a chain that does not read, and a source with no system", async () => {
      const v1 = shop("reference: string");
      const chain = asChain(await record({ source: v1, name: "initial" }));
      const v2 = shop("reference: string\n    note: string?");

      const badName = await record({ source: v2, migrations: chain, name: "AddNote" });
      expect(badName.ok).toBe(false);
      expect(badName.needsAcknowledgement).toBe(false);
      expect(badName.diagnostics.map((d) => d.code)).toEqual(["loom.migration-name-invalid"]);
      const taken = await record({ source: v2, migrations: chain, name: "initial" });
      expect(taken.diagnostics.map((d) => d.code)).toEqual(["loom.migration-name-invalid"]);

      const broken = [{ name: "x.json", content: "<<<<<<<" }];
      const brokenStatus = await status({ source: v2, migrations: broken });
      expect(brokenStatus.ok).toBe(false);
      expect(brokenStatus.diagnostics.map((d) => d.code)).toEqual(["loom.migration-chain-invalid"]);
      const brokenRecord = await record({ source: v2, migrations: broken, name: "add-note" });
      expect(brokenRecord.diagnostics.map((d) => d.code)).toEqual(["loom.migration-chain-invalid"]);

      const loose = await status({ source: CLEAN });
      expect(loose.ok).toBe(true);
      expect(loose.unrecorded).toBe(false);
      expect(loose.diagnostics.map((d) => d.code)).toEqual(["loom.no-system"]);
      const looseRecord = await record({ source: CLEAN, name: "initial" });
      expect(looseRecord.ok).toBe(false);
      expect(looseRecord.diagnostics.map((d) => d.code)).toEqual(["loom.no-system"]);

      const invalid = await status({ source: BARE });
      expect(invalid.ok).toBe(false);
      await expect(record({ source: v1, name: "x", now: "today" })).rejects.toThrow(
        /YYYYMMDDHHMMSS/,
      );
      await expect(record({ source: v1, name: "x", allowDestructive: "yes" })).rejects.toThrow(
        /must be a boolean/,
      );
    });
  });

  it("loom_snapshot captures nothing for a model with no provenanced field", async () => {
    const r = (await callTool("loom_snapshot", { source: CLEAN })) as SnapshotReport;
    expect(r.ok).toBe(true);
    expect(r.files).toEqual([]);
  });

  it("rejects unknown tools and bad args", async () => {
    await expect(callTool("loom_nope", {})).rejects.toThrow(/unknown tool/);
    await expect(callTool("loom_validate", {})).rejects.toThrow(/must be a string/);
  });
});

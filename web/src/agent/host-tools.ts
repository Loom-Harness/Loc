// ---------------------------------------------------------------------------
// The playground's own agent tools — the migration verbs run against the
// WORKSPACE (its model, its committed chain, its runtime database) instead of
// against arguments.
//
// The catalog's `loom_migration_status` / `loom_migration_record` are pure:
// they take a source plus a chain and return what to write.  In the playground
// the chain lives in the workspace and recording has to land there, so the
// chat layers these host tools over the catalog (`withHostTools`):
//
//   - `loom_migration_status` — the catalog tool, with the workspace's source
//     and chain filled in for whatever the agent leaves out;
//   - `loom_migration_record` — records through the host's `recordMigration`,
//     the path the Migrations tab and the strip badge's Record migration take,
//     so the chain entry, the badge and the tab move together;
//   - `loom_migration_apply` — runs the badge's Apply (Generate → Bundle →
//     Boot), which applies the recorded entries the runtime database lacks.
//
// Recording and applying act on the model the workspace holds.  An agent edit
// held back by the plan gate is not in the workspace until the turn settles,
// so a call naming a different `source` is refused rather than recording or
// booting a model the user has not approved.
// ---------------------------------------------------------------------------

import { TOOLS_BY_NAME, type ToolDef } from "../../../src/tools/index.js";
import type { RecordMigrationResult } from "../build/protocol.js";
import type { BlockingMigrationState } from "../runtime/protocol.js";

/** One file of the workspace's `migrations/` directory. */
export interface ChainFileView {
  name: string;
  content: string;
}

/** How an Apply ended. */
export type ApplyOutcome =
  /** The backend booted: the database is at the chain's head. */
  | { kind: "booted"; applied: string[]; head: string | null }
  /** The boot stopped short of starting the app because of the database's
   *  migrations (unrecorded changes, a database the chain cannot place). */
  | { kind: "pending"; migration: BlockingMigrationState; message: string }
  /** A step of the cascade failed before or during the boot. */
  | { kind: "failed"; stage: "generate" | "bundle" | "boot"; message: string };

/** What the playground lends the migration tools. */
export interface MigrationHost {
  /** The entry `.ddd` as the workspace holds it now. */
  workspaceSource: () => string;
  /** The files of the workspace's `migrations/` directory; `undefined` when
   *  it has none. */
  chainFiles: () => Promise<ChainFileView[] | undefined>;
  /** Record the workspace model's changes as the next chain entries (the
   *  Migrations tab's Record migration).  `null` when the build worker is
   *  not up. */
  recordMigration: (name: string, allowDestructive: boolean) => Promise<RecordMigrationResult | null>;
  /** Generate, bundle and boot — the strip badge's Apply. */
  applyMigrations: () => Promise<ApplyOutcome>;
}

/** The codes the destructive gate refuses with: recording needs the
 *  acknowledgement. */
const ACKNOWLEDGEABLE = new Set([
  "loom.migration-destructive",
  "loom.migration-ambiguous-rename",
  "loom.migration-shape-change",
]);

const NOT_WRITTEN =
  "That source is not the model in the workspace yet: the playground writes your edit when this turn ends and the user approves its plan. End the turn; record and apply in the next one. Omit `source` to act on the workspace model as it is.";

const sameSource = (a: string, b: string): boolean => a.trim() === b.trim();

function optSource(args: Record<string, unknown>): string | undefined {
  const v = args.source;
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw new Error("'source' must be a string");
  return v;
}

/** Refuse a call naming a model other than the workspace's. */
function requireWorkspaceSource(host: MigrationHost, args: Record<string, unknown>): void {
  const source = optSource(args);
  if (source !== undefined && !sameSource(source, host.workspaceSource())) {
    throw new Error(NOT_WRITTEN);
  }
}

const baseName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/** The migration tools bound to `host`, to layer over the catalog with
 *  `withHostTools`. */
export function migrationHostTools(host: MigrationHost): ToolDef[] {
  const status = TOOLS_BY_NAME.loom_migration_status!;
  const record = TOOLS_BY_NAME.loom_migration_record!;
  return [
    {
      name: status.name,
      description: `${status.description} In the playground, \`source\` defaults to the workspace model and \`migrations\` to the workspace's committed chain, so a bare call reports the workspace.`,
      inputSchema: {
        type: "object",
        properties: {
          source: {
            type: "string",
            description: "The .ddd model source. Default: the workspace model.",
          },
          migrations: {
            ...((status.inputSchema.properties as Record<string, object>).migrations ?? {}),
            description:
              "The chain's files ({ name, content }). Default: the workspace's migrations/ directory.",
          },
        },
        additionalProperties: false,
      },
      handler: async (args) =>
        status.handler({
          source: optSource(args) ?? host.workspaceSource(),
          migrations: args.migrations ?? (await host.chainFiles()),
        }),
    },
    {
      name: record.name,
      description:
        "Record the workspace model's schema changes since the chain's head as a new named migration — the playground's Record migration (`ddd migrate add <name> [--allow-destructive]`). The entries are written into the workspace's migrations/ directory; the pipeline strip's migration badge and the Migrations tab update. A destructive change (a dropped column or table, a NOT NULL add with no backfill, a narrowing type, a reshape) is REFUSED (`ok: false`, `needsAcknowledgement: true`) unless `allowDestructive` is true — set it only once the data loss is intended, never as a default. Records the model the workspace holds: a `source` that differs from it is refused. Check loom_migration_status first; apply with loom_migration_apply.",
      inputSchema: {
        type: "object",
        properties: {
          source: {
            type: "string",
            description:
              "Optional: the .ddd source you expect the workspace to hold; refused when it does not.",
          },
          name: (record.inputSchema.properties as Record<string, object>).name,
          allowDestructive: (record.inputSchema.properties as Record<string, object>)
            .allowDestructive,
        },
        required: ["name"],
        additionalProperties: false,
      },
      handler: async (args) => {
        requireWorkspaceSource(host, args);
        const name = args.name;
        if (typeof name !== "string") throw new Error("'name' must be a string");
        const allow = args.allowDestructive;
        if (allow !== undefined && typeof allow !== "boolean") {
          throw new Error("'allowDestructive' must be a boolean");
        }
        const result = await host.recordMigration(name, allow === true);
        if (!result) throw new Error("The playground's build worker is not ready; try again.");
        return {
          ok: result.ok,
          written: result.ok,
          files: result.ok ? result.files.map((f) => ({ name: baseName(f.path), path: f.path })) : [],
          needsAcknowledgement:
            !result.ok && result.diagnostics.some((d) => d.code && ACKNOWLEDGEABLE.has(d.code)),
          diagnostics: result.diagnostics,
        };
      },
    },
    {
      name: "loom_migration_apply",
      description:
        "Apply the recorded migrations to the playground's runtime database: generate, bundle and boot the backend (the pipeline strip badge's Apply). A boot applies the chain's entries the database lacks, and ONLY those — a schema change that is not recorded is never applied (`pending`, kind `unrecorded`): record it with loom_migration_record first. Returns `booted` (with the units applied and the database head), `pending`, or `failed` with the stage. Acts on the workspace model; a `source` that differs from it is refused.",
      inputSchema: {
        type: "object",
        properties: {
          source: {
            type: "string",
            description:
              "Optional: the .ddd source you expect the workspace to hold; refused when it does not.",
          },
        },
        additionalProperties: false,
      },
      handler: async (args) => {
        requireWorkspaceSource(host, args);
        return host.applyMigrations();
      },
    },
  ];
}

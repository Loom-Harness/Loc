import type { Command } from "commander";
import {
  EMPTY_CHAIN,
  entryFileName,
  kebabName,
  MIGRATIONS_DIR,
  type MigrationChain,
  MigrationChainError,
  MigrationDriftError,
  parseChain,
  parseForkedChain,
  utcVersionNow,
} from "../../system/migration-chain.js";
import {
  migrationStatus,
  recordPendingMigrations,
  refusalText,
} from "../../system/migration-diff.js";
import {
  MigrationBackfillDiscardedError,
  MigrationDestructiveError,
  MigrationShapeChangeError,
  MigrationSqlScopeError,
  type MigrationWarning,
} from "../../system/migrations-builder.js";
import {
  deleteChainEntries,
  readChainFiles,
  readMigrationChain,
  readMigrationChainOrEmpty,
  writeChainEntries,
} from "../migrate.js";
import { loadValidProject, relPath } from "../project.js";
import { ALL_WARNINGS_FLAG, ALL_WARNINGS_HELP } from "../report.js";
import { printMigrationWarnings } from "./generate.js";

/** The migration failures that are an operator's to fix — reported as a clean
 *  CLI failure with the error's own recovery hint, never as a crash. */
export function isMigrationRefusal(err: unknown): err is Error {
  return (
    err instanceof MigrationChainError ||
    err instanceof MigrationDriftError ||
    err instanceof MigrationDestructiveError ||
    err instanceof MigrationBackfillDiscardedError ||
    err instanceof MigrationShapeChangeError ||
    err instanceof MigrationSqlScopeError
  );
}

/** Run `body`, reporting a migration refusal as a clean failure. */
async function migrationCommand(file: string, body: () => Promise<boolean>): Promise<boolean> {
  try {
    return await body();
  } catch (err) {
    if (isMigrationRefusal(err)) {
      console.error(`${file}: ${refusalText(err)}`);
      return false;
    }
    throw err;
  }
}

/** `ddd migrate add` — diff the model against the chain's head and append
 *  the result.  Returns false on any error (already printed). */
async function runMigrateAdd(
  name: string,
  file: string,
  options: { allowDestructive?: boolean; allWarnings?: boolean },
): Promise<boolean> {
  const loom = await loadValidProject(file, options.allWarnings);
  if (!loom) return false;
  return migrationCommand(file, async () => {
    const migrationWarnings: MigrationWarning[] = [];
    const entries = recordPendingMigrations(loom, readMigrationChainOrEmpty(file), {
      name,
      now: utcVersionNow(),
      allowDestructive: options.allowDestructive,
      warnings: migrationWarnings,
    });
    printMigrationWarnings(migrationWarnings);
    if (entries.length === 0) {
      console.log("No schema changes since the last recorded migration.");
      return true;
    }
    for (const written of writeChainEntries(file, entries)) {
      console.log(`  recorded  ${relPath(written)}`);
    }
    return true;
  });
}

/** `ddd migrate status` — what the chain records against what the model
 *  describes.  Fails only when `migrations/` cannot be read as one chain. */
async function runMigrateStatus(
  file: string,
  options: { json?: boolean; allWarnings?: boolean },
): Promise<boolean> {
  const loom = await loadValidProject(file, options.allWarnings);
  if (!loom) return false;
  return migrationCommand(file, async () => {
    const files = readChainFiles(file);
    const fork = files ? parseForkedChain(files) : null;
    if (fork) {
      const [a, b] = fork.tails;
      throw new MigrationChainError(
        `the chain has two heads: ${entryFileName(a.at(-1)!)} and ${entryFileName(b.at(-1)!)}. ` +
          "Run `ddd migrate rebase <file.ddd>` to record the later one again on top of the other.",
      );
    }
    const chain = files ? parseChain(files) : EMPTY_CHAIN;
    const { modules, spentBlocks } = migrationStatus(loom, chain);
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            recorded: files !== undefined,
            entries: chain.entries.length,
            head: chain.entries.at(-1)?.version ?? null,
            modules: modules.map(({ destructiveMessage: _, ...m }) => m),
            spentBlocks,
          },
          null,
          2,
        ),
      );
      return true;
    }
    if (!files) {
      console.log(
        `No ${MIGRATIONS_DIR}/ yet: \`generate\` derives each module's initial migration from the model. ` +
          `Run \`ddd migrate add initial ${file}\` to start recording.`,
      );
    } else {
      const head = chain.entries.at(-1);
      console.log(
        `${MIGRATIONS_DIR}/: ${chain.entries.length} recorded migration(s)` +
          (head ? `, head ${head.version} (${head.module} ${head.name})` : ""),
      );
    }
    const width = Math.max(0, ...modules.map((m) => m.module.length));
    for (const m of modules) {
      const state =
        m.unrecordedSteps === 0
          ? m.head
            ? `up to date at ${m.head.version} ${m.head.name}`
            : "no tables"
          : `${m.unrecordedSteps} unrecorded step(s)${m.head ? "" : " (its Initial)"}${m.destructive ? ", destructive" : ""}`;
      console.log(`  ${m.module.padEnd(width)}  ${state}`);
    }
    if (files && modules.some((m) => m.unrecordedSteps > 0)) {
      console.log(
        modules.some((m) => m.destructive)
          ? `Record them with \`ddd migrate add <name> ${file} --allow-destructive\` once the data loss is intended.`
          : `Record them with \`ddd migrate add <name> ${file}\`.`,
      );
    }
    for (const b of spentBlocks) console.log(`  ${b}`);
    return true;
  });
}

/** `ddd migrate remove` — delete the chain's head entry, so the module's
 *  previous entry is the baseline again. */
async function runMigrateRemove(file: string): Promise<boolean> {
  return migrationCommand(file, async () => {
    const chain = readMigrationChain(file);
    const head = chain?.entries.at(-1);
    if (!chain || !head) {
      console.error(`${file}: there is no recorded migration to remove.`);
      return false;
    }
    for (const removed of deleteChainEntries(file, [head])) {
      console.log(`  removed   ${relPath(removed)}`);
    }
    const now = chain.entries.at(-2);
    console.log(
      now
        ? `Head is now ${now.version} (${now.module} ${now.name}).`
        : `${MIGRATIONS_DIR}/ is now empty.`,
    );
    console.log(
      "Remove only a migration no database has applied; an applied one stays, and a fix is a new migration.",
    );
    return true;
  });
}

/** `ddd migrate rebase` — after a merge leaves two heads, delete one tail and
 *  record the model's changes again on top of the other. */
async function runMigrateRebase(
  file: string,
  options: { move?: string; name?: string; allWarnings?: boolean },
): Promise<boolean> {
  const loom = await loadValidProject(file, options.allWarnings);
  if (!loom) return false;
  return migrationCommand(file, async () => {
    const files = readChainFiles(file) ?? [];
    const fork = parseForkedChain(files);
    if (!fork) {
      parseChain(files);
      console.log("The chain has one head; there is nothing to rebase.");
      return true;
    }
    const pick = options.move ? fork.tails.findIndex((t) => t[0]!.version === options.move) : 1;
    if (pick < 0) {
      throw new MigrationChainError(
        `--move ${options.move} names no tail's first migration; the tails start at ${fork.tails[0][0]!.version} and ${fork.tails[1][0]!.version}.`,
      );
    }
    const moved = fork.tails[pick]!;
    const kept: MigrationChain = { entries: [...fork.base, ...fork.tails[1 - pick]!] };
    const allowDestructive = moved.some((e) => e.allowDestructive);
    const name =
      options.name ?? kebabName(moved.find((e) => e.name !== "Initial")?.name ?? "Initial");
    const warnings: MigrationWarning[] = [];
    const entries = recordPendingMigrations(loom, kept, {
      name,
      now: utcVersionNow(),
      allowDestructive,
      warnings,
    });
    printMigrationWarnings(warnings);
    for (const removed of deleteChainEntries(file, moved)) {
      console.log(`  removed   ${relPath(removed)}`);
    }
    for (const written of writeChainEntries(file, entries)) {
      console.log(`  recorded  ${relPath(written)}`);
    }
    if (entries.length === 0) {
      console.log(
        "The other branch's migrations already record every change; nothing to re-record.",
      );
    }
    return true;
  });
}

/** Registers `ddd migrate` on the CLI program. */
export function registerMigrateCommand(program: Command): void {
  const migrate = program
    .command("migrate")
    .description("Record schema changes in the migration chain (migrations/ beside the .ddd)");

  migrate
    .command("add <name> <file>")
    .description(
      "Record the model's schema changes since the chain's head as a new migration named <name> (kebab-case). See docs/migrations.md.",
    )
    .option(
      "--allow-destructive",
      "permit destructive steps (column/table drops, NOT-NULL adds without a default on a populated table, reshapes); recorded in the migration. Off by default a destructive change aborts.",
    )
    .option(ALL_WARNINGS_FLAG, ALL_WARNINGS_HELP)
    .action(
      async (
        name: string,
        file: string,
        options: { allowDestructive?: boolean; allWarnings?: boolean },
      ) => {
        process.exit((await runMigrateAdd(name, file, options)) ? 0 : 1);
      },
    );

  migrate
    .command("status <file>")
    .description(
      "Show what the migration chain records against what the model describes: each module's head and any unrecorded schema change. Fails only when migrations/ cannot be read as one chain.",
    )
    .option("--json", "print the status as JSON")
    .option(ALL_WARNINGS_FLAG, ALL_WARNINGS_HELP)
    .action(async (file: string, options: { json?: boolean; allWarnings?: boolean }) => {
      process.exit((await runMigrateStatus(file, options)) ? 0 : 1);
    });

  migrate
    .command("remove <file>")
    .description(
      "Delete the chain's newest migration, so the next `migrate add` diffs against the one before it. Only for a migration no database has applied.",
    )
    .action(async (file: string) => {
      process.exit((await runMigrateRemove(file)) ? 0 : 1);
    });

  migrate
    .command("rebase <file>")
    .description(
      "After a merge leaves the chain with two heads, delete the later-recorded branch's migrations and record the model's changes again on top of the other's.",
    )
    .option("--move <version>", "move the branch whose first migration has this version instead")
    .option(
      "--name <name>",
      "kebab-case name for the re-recorded migration (default: the moved one's)",
    )
    .option(ALL_WARNINGS_FLAG, ALL_WARNINGS_HELP)
    .action(
      async (file: string, options: { move?: string; name?: string; allWarnings?: boolean }) => {
        process.exit((await runMigrateRebase(file, options)) ? 0 : 1);
      },
    );
}

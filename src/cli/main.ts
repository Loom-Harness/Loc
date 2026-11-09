import { Command } from "commander";
import { LOOM_VERSION } from "../api/index.js";
import { installFsBackendSource } from "../platform/fs-discovery.js";
import { registerBreakpointsCommand } from "./commands/breakpoints.js";
import { registerDiffCommand } from "./commands/diff.js";
import { registerGenerateCommand } from "./commands/generate.js";
import { registerI18nCommand } from "./commands/i18n.js";
import { registerMigrateCommand } from "./commands/migrate.js";
import { registerNewCommand } from "./commands/new.js";
import { registerParseCommand } from "./commands/parse.js";
import { registerPatchCommand } from "./commands/patch.js";
import { registerSnapshotCommand } from "./commands/snapshot.js";
import { registerTraceCommand } from "./commands/trace.js";
import { registerVerifyCommand } from "./commands/verify.js";

const program = new Command();

program.name("ddd").description("DDD DSL CLI").version(LOOM_VERSION);

registerParseCommand(program);
registerPatchCommand(program);
registerGenerateCommand(program);
registerMigrateCommand(program);
registerDiffCommand(program);
registerVerifyCommand(program);
registerTraceCommand(program);
registerBreakpointsCommand(program);
registerSnapshotCommand(program);
registerNewCommand(program);
registerI18nCommand(program);

// Install the fs-backed `discoverBackends()` source before any
// platform resolution.  Composes the in-tree default with whatever
// `@loom/*` backend packages are installed in the project's
// `node_modules`.  Today this is a no-op for emitted output because
// the fs source returns the same surface instances as the in-tree
// default; once the workspace package becomes the true source of
// code, this call becomes load-bearing.  Errors during fs walk
// (missing `node_modules`, permission, malformed manifest) are
// non-fatal — the function returns whatever it could read, and the
// composition falls back to the in-tree set.
await installFsBackendSource(process.cwd()).catch((err) => {
  // Don't take down the CLI for a discovery hiccup; just leave the
  // in-tree default active.
  console.warn(
    `loom: fs backend discovery skipped (${
      err instanceof Error ? err.message : String(err)
    }); using in-tree default.`,
  );
});

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// CLI gate for the destructive-change policy (A8.3 / audit finding 19).
// Recording a generation that would ADD a required (NOT NULL, no default)
// column to a table the chain already created must abort — unless
// `migrate add` gets --allow-destructive, which records the safe
// add-nullable / backfill-TODO / SET NOT NULL sequence instead.
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const cli = path.join(repoRoot, "bin", "cli.js");

function runCli(args: string[]): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execSync(`node ${cli} ${args.join(" ")}`, {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
    return { stdout, stderr: "", status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", status: e.status ?? 1 };
  }
}

const V1 = `
system Shop {
  subdomain Sales {
    context Orders {
      aggregate Order { total: int }
      repository Orders for Order { }
    }
  }
  storage pg { type: postgres }
  resource ordersState { for: Orders, kind: state, use: pg }
  deployable api { platform: node, contexts: [Orders], dataSources: [ordersState], port: 3000 }
}
`;

// V2 adds a required (NOT NULL) column to the already-migrated `orders` table.
const V2 = `
system Shop {
  subdomain Sales {
    context Orders {
      aggregate Order { total: int  status: string }
      repository Orders for Order { }
    }
  }
  storage pg { type: postgres }
  resource ordersState { for: Orders, kind: state, use: pg }
  deployable api { platform: node, contexts: [Orders], dataSources: [ordersState], port: 3000 }
}
`;

describe("migrate add — destructive-change gate", () => {
  it("aborts a NOT-NULL-add delta without --allow-destructive, then records it with the flag", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loom-destructive-"));
    const dddPath = path.join(tmp, "main.ddd");
    const out = path.join(tmp, "out");

    // 1) Record V1 — the chain's Initial.
    fs.writeFileSync(dddPath, V1);
    const first = runCli(["migrate", "add", "initial", dddPath]);
    expect(first.status).toBe(0);
    expect(fs.readdirSync(path.join(tmp, "migrations"))).toHaveLength(1);

    // 2) V2 adds the required column → recording it aborts as destructive,
    //    and nothing is written.
    fs.writeFileSync(dddPath, V2);
    const blocked = runCli(["migrate", "add", "add-status", dddPath]);
    expect(blocked.status).not.toBe(0);
    expect(blocked.stderr).toMatch(/destructive/i);
    expect(blocked.stderr).toMatch(/status/);
    expect(fs.readdirSync(path.join(tmp, "migrations"))).toHaveLength(1);

    // …and generate refuses the unrecorded change.
    const unrecorded = runCli(["generate", "system", dddPath, "-o", out]);
    expect(unrecorded.status).not.toBe(0);
    expect(unrecorded.stderr).toMatch(/not recorded in migrations\//);

    // 3) With --allow-destructive the delta is recorded, marked as allowed,
    //    and rendered through the safe add-nullable / backfill / SET NOT NULL
    //    path.
    const allowed = runCli(["migrate", "add", "add-status", dddPath, "--allow-destructive"]);
    expect(allowed.status).toBe(0);
    const entries = fs.readdirSync(path.join(tmp, "migrations")).sort();
    expect(entries).toHaveLength(2);
    expect(
      JSON.parse(fs.readFileSync(path.join(tmp, "migrations", entries[1]!), "utf8"))
        .allowDestructive,
    ).toBe(true);
    expect(runCli(["generate", "system", dddPath, "-o", out]).status).toBe(0);
    const migDir = path.join(out, "api", "db", "migrations");
    const delta = fs
      .readdirSync(migDir)
      .filter((f) => f.endsWith("_add_status.sql"))
      .map((f) => fs.readFileSync(path.join(migDir, f), "utf8"))
      .join("\n");
    // The context defaults to its own `orders` Postgres schema, so the
    // relation is schema-qualified `orders.orders`.
    expect(delta).toMatch(/ADD COLUMN "status" TEXT NULL/);
    expect(delta).toMatch(/-- TODO backfill orders\.orders\.status/);
    expect(delta).toMatch(/ALTER COLUMN "status" SET NOT NULL/);

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

// Run one compile job: `node sweep/compile.mjs <id> <cwd> <tier> <axesJSON> -- <cmd...>`
import { spawnSync } from "node:child_process";
import { record, already } from "./record.mjs";
const argv = process.argv.slice(2);
const dash = argv.indexOf("--");
const [id, cwd, tier, axesJson] = argv.slice(0, dash);
const cmd = argv.slice(dash + 1);
if (already(id) && !process.env.REDO) { console.log(`[skip] ${id}`); process.exit(0); }
const t0 = Date.now();
const r = spawnSync(cmd[0], cmd.slice(1), { cwd, encoding: "utf8", shell: false, maxBuffer: 64 * 1024 * 1024 });
const dur = +((Date.now() - t0) / 1000).toFixed(1);
const out = ((r.stdout || "") + "\n" + (r.stderr || "")).trim();
const ok = r.status === 0;
record({
  id, tier, ...JSON.parse(axesJson),
  command: cmd.join(" "), cwd,
  verdict: ok ? "pass" : "fail",
  duration_s: dur,
  artifact: cwd,
  error_head: ok ? "" : out.split("\n").filter((l) => l.trim()).slice(-40).join("\n").slice(-4000),
});
process.exit(0);

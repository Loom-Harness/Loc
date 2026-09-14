// T1 generation pass: every backend x frontend, same probe-domain model.
import { execFileSync } from "node:child_process";
import { rmSync, mkdirSync, readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { render } from "./render.mjs";

const BACKENDS = ["node", "node@v4", "dotnet", "elixir", "python", "java"];
const FRONTENDS = ["react", "vue", "svelte", "angular", "feliz", "flutter"];
// default design pack per frontend framework (bareword default when omitted)
const ROOT = "sweep/out/t1";

function walk(dir, base = dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, base, acc);
    else acc.push(p.slice(base.length + 1));
  }
  return acc.sort();
}
function treeHash(dir) {
  const h = createHash("sha256");
  let bytes = 0, files = 0;
  for (const rel of walk(dir)) {
    const buf = readFileSync(join(dir, rel));
    h.update(rel); h.update(buf);
    bytes += buf.length; files++;
  }
  return { hash: h.digest("hex").slice(0, 16), bytes, files };
}

const rows = [];
for (const backend of BACKENDS) {
  for (const frontend of FRONTENDS) {
    const id = `${backend.replace("@", "-")}__${frontend}`;
    const dir = join(ROOT, id);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const model = render("sweep/models/probe-domain.ddd", { backend, frontend }, join(dir, "model.ddd"));
    const t0 = Date.now();
    let ok = true, err = "";
    try {
      execFileSync("node", ["bin/cli.js", "generate", "system", model, "-o", join(dir, "gen")], {
        stdio: ["ignore", "pipe", "pipe"], encoding: "utf8",
      });
    } catch (e) {
      ok = false;
      err = ((e.stderr || "") + (e.stdout || "")).trim().split("\n").slice(0, 6).join("\n");
    }
    const ms = Date.now() - t0;
    const row = { tier: "T1", id, backend, frontend, gen_ok: ok, gen_ms: ms, gen_err: err };
    if (ok) {
      const projects = readdirSync(join(dir, "gen")).filter((d) =>
        statSync(join(dir, "gen", d)).isDirectory() && !["db-init", "monitoring", ".loom"].includes(d));
      row.projects = {};
      for (const p of projects) row.projects[p] = treeHash(join(dir, "gen", p));
    }
    rows.push(row);
    console.log(`${ok ? "gen-ok " : "GEN-FAIL"} ${id} ${ms}ms ${ok ? Object.keys(row.projects).join(",") : err.split("\n")[0]}`);
  }
}
writeFileSync("sweep/t1-gen.json", JSON.stringify(rows, null, 2));

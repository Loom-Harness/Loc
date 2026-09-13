// T2: probe-ui.ddd against EVERY pack family AND version, on the pack's own framework.
import { execFileSync } from "node:child_process";
import { rmSync, mkdirSync, writeFileSync, readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderUi } from "./render-ui.mjs";

export const PACKS = [
  // react (8)
  { pack: "chakra@v2", fw: "react" }, { pack: "chakra@v3", fw: "react" },
  { pack: "mantine@v7", fw: "react" }, { pack: "mantine@v9", fw: "react" },
  { pack: "mui@v5", fw: "react" }, { pack: "mui@v7", fw: "react" },
  { pack: "shadcn@v3", fw: "react" }, { pack: "shadcn@v4", fw: "react" },
  // vue (2)
  { pack: "shadcnVue@v1", fw: "vue" }, { pack: "vuetify@v3", fw: "vue" },
  // svelte (2)
  { pack: "flowbite@v1", fw: "svelte" }, { pack: "shadcnSvelte@v1", fw: "svelte" },
  // angular (3)
  { pack: "angularMaterial@v1", fw: "angular" }, { pack: "primeng@v1", fw: "angular" },
  { pack: "spartanNg@v1", fw: "angular" },
  // heex (2) — Phoenix LiveView is fullstack, so the frontend platform IS elixir
  { pack: "coreComponents@v3", fw: "elixir" }, { pack: "daisyui@v1", fw: "elixir" },
];

function walk(d, b = d, a = []) { for (const e of readdirSync(d)) { const p = join(d, e); statSync(p).isDirectory() ? walk(p, b, a) : a.push(p.slice(b.length + 1)); } return a; }

if (process.argv[1].endsWith("gen-t2.mjs")) {
  const out = [];
  for (const { pack, fw } of PACKS) {
    const id = pack.replace("@", "-");
    const dir = join("sweep/out/t2", id);
    rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
    const model = renderUi({ frontend: fw, design: pack }, join(dir, "model.ddd"));
    const t0 = Date.now(); let ok = true, err = "";
    try { execFileSync("node", ["bin/cli.js", "generate", "system", model, "-o", join(dir, "gen")], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
    catch (e) { ok = false; err = ((e.stderr || "") + (e.stdout || "")).split("\n").filter(l => /Error|error/.test(l)).slice(0, 3).join(" | "); }
    const ms = Date.now() - t0;
    let files = 0, bytes = 0, proj = null;
    if (ok) {
      proj = readdirSync(join(dir, "gen")).find((d) => ["web_app", "api"].includes(d) && statSync(join(dir, "gen", d)).isDirectory());
      const target = fw === "elixir" ? "api" : "web_app";
      for (const rel of walk(join(dir, "gen", target))) { files++; bytes += readFileSync(join(dir, "gen", target, rel)).length; }
      proj = target;
    }
    out.push({ pack, fw, id, gen_ok: ok, gen_ms: ms, gen_err: err, project: proj, files, kb: Math.round(bytes / 1024) });
    console.log(`${ok ? "gen-ok " : "GEN-FAIL"} ${id.padEnd(20)} ${fw.padEnd(8)} ${ms}ms ${files} files ${Math.round(bytes / 1024)}KB ${err}`);
  }
  writeFileSync("sweep/t2-gen.json", JSON.stringify(out, null, 2));
}

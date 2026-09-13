import { execFileSync } from "node:child_process";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderUi } from "./render-ui.mjs";
import { PACKS } from "./gen-t2.mjs";
const out = [];
for (const { pack, fw } of PACKS) {
  const id = pack.replace("@", "-");
  const dir = join("sweep/out/t2r", id);
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const model = renderUi({ frontend: fw, design: pack, reduced: true }, join(dir, "model.ddd"));
  let ok = true, err = "";
  try { execFileSync("node", ["bin/cli.js", "generate", "system", model, "-o", join(dir, "gen")], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { ok = false; err = ((e.stderr || "") + (e.stdout || "")).split("\n").filter(l => /Error/.test(l)).slice(0, 2).join(" | "); }
  out.push({ pack, fw, id, gen_ok: ok, gen_err: err });
  console.log(`${ok ? "gen-ok " : "GEN-FAIL"} ${id} ${err}`);
}
writeFileSync("sweep/t2r-gen.json", JSON.stringify(out, null, 2));

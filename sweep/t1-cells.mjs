// Derive the 36 T1 cell verdicts from the per-half compile results + the
// generation pass, and append them to results.jsonl.
import { readFileSync, appendFileSync } from "node:fs";
const res = readFileSync("sweep/results.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));
const half = (id) => [...res].reverse().find((r) => r.id === id);
const gen = JSON.parse(readFileSync("sweep/t1-gen.json", "utf8"));
const BK = { node: "node@v5", "node@v4": "node@v4", dotnet: "dotnet", elixir: "elixir", python: "python", java: "java" };
const out = [];
for (const g of gen) {
  const b = half(`T1/backend/${BK[g.backend]}`), f = half(`T1/frontend/${g.frontend}`);
  const bv = b?.verdict ?? "unverified", fv = f?.verdict ?? "unverified";
  const verdict = !g.gen_ok ? "fail"
    : bv === "pass" && fv === "pass" ? "pass"
    : bv === "unverified" || fv === "unverified" ? "unverified"
    : bv === "pass" || fv === "pass" ? "partial" : "fail";
  out.push({
    ts: new Date().toISOString(), tier: "T1", id: `T1/cell/${g.id}`,
    axis: "backend x frontend", backend: g.backend, frontend: g.frontend,
    model: "probe-domain.ddd", verdict,
    generate_ok: g.gen_ok, generate_s: +(g.gen_ms / 1000).toFixed(1),
    backend_compile: bv, frontend_compile: fv,
    backend_cmd: b?.command ?? null, frontend_cmd: f?.command ?? null,
    duration_s: +(((b?.duration_s ?? 0) + (f?.duration_s ?? 0)) || 0).toFixed(1),
    artifact: `sweep/out/t1/${g.id}/gen`,
    out_files: { api: g.projects?.api?.files, api_kb: Math.round((g.projects?.api?.bytes ?? 0) / 1024),
                 web: g.projects?.web_app?.files, web_kb: Math.round((g.projects?.web_app?.bytes ?? 0) / 1024) },
    error_head: [bv !== "pass" ? `backend: ${b?.error_head?.split("\n").find((l)=>/error|Error/.test(l)) ?? bv}` : "",
                 fv !== "pass" ? `frontend: ${f?.error_head?.split("\n").find((l)=>/error|Error/.test(l)) ?? fv}` : ""].filter(Boolean).join(" | ").slice(0, 400),
  });
}
appendFileSync("sweep/results.jsonl", out.map((o) => JSON.stringify(o)).join("\n") + "\n");
const c = {}; for (const o of out) c[o.verdict] = (c[o.verdict] ?? 0) + 1;
console.log("T1 cells:", JSON.stringify(c));

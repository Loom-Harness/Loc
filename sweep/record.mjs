import { appendFileSync, existsSync, readFileSync } from "node:fs";
const FILE = "sweep/results.jsonl";
export function already(id) {
  if (!existsSync(FILE)) return false;
  return readFileSync(FILE, "utf8").split("\n").filter(Boolean)
    .some((l) => { try { return JSON.parse(l).id === id; } catch { return false; } });
}
export function record(row) {
  appendFileSync(FILE, JSON.stringify({ ts: new Date().toISOString(), ...row }) + "\n");
  console.log(`[${row.verdict}] ${row.id} ${row.duration_s}s ${row.error_head ? "| " + row.error_head.split("\n")[0].slice(0, 110) : ""}`);
}

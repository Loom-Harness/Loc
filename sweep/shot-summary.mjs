import { readFileSync, readdirSync, existsSync } from "node:fs";
const CDN = /cdn\.jsdelivr\.net|unpkg\.com|cdnjs/;
const rows = [];
for (const p of readdirSync("sweep/shots")) {
  const f = `sweep/shots/${p}/report.json`;
  if (!existsSync(f)) { console.log(`${p.padEnd(20)} (no report — still running)`); continue; }
  const r = JSON.parse(readFileSync(f, "utf8"));
  for (const x of r) {
    x.cdnBlocked = (x.failedReqs ?? []).filter((u) => CDN.test(u));
    x.realFailed = (x.failedReqs ?? []).filter((u) => !CDN.test(u));
    x.realConsole = (x.consoleErrors ?? []).filter((e) =>
      !(/ERR_CONNECTION_RESET|ERR_NAME_NOT_RESOLVED|ERR_BLOCKED/.test(e) && x.cdnBlocked.length));
  }
  const bad = r.filter((x) => x.err || x.realConsole.length || x.realFailed.length || (x.chars ?? 0) < 20 || x.hOverflow);
  const blank = r.filter((x) => (x.chars ?? 0) < 20);
  rows.push({ pack: p, shots: r.length, problems: bad.length, blank: blank.length,
    overflow: r.filter((x) => x.hOverflow).length,
    cdn: r.some((x) => x.cdnBlocked.length) ? "highlight.js CDN" : "none",
    medianChars: r.map((x) => x.chars ?? 0).sort((a, b) => a - b)[Math.floor(r.length / 2)],
    medianNodes: r.map((x) => x.nodes ?? 0).sort((a, b) => a - b)[Math.floor(r.length / 2)],
    focusables: r.find((x) => x.page === "inputs" && x.viewport === "desktop" && x.scheme === "light")?.focusables ?? 0 });
}
console.table(rows);

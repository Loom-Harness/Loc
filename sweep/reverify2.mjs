// Second re-verification batch: the findings the first pass did not cover.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, rmSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const walk = (d, a = []) => { for (const e of readdirSync(d)) { const p = join(d, e); statSync(p).isDirectory() ? walk(p, a) : a.push(p); } return a; };
const grepTree = (d, re) => walk(d).filter(f => { try { return re.test(readFileSync(f, "utf8")); } catch { return false; } });
function gen(ddd, out, mutate) {
  rmSync(out, { recursive: true, force: true });
  let src = ddd;
  if (mutate) { src = `${out}.ddd`; writeFileSync(src, mutate(readFileSync(ddd, "utf8"))); }
  return execFileSync("node", ["bin/cli.js", "generate", "system", src, "-o", out], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
function diags(ddd, mutate) {
  let src = ddd;
  if (mutate) { src = "/tmp/rv/d.ddd"; writeFileSync(src, mutate(readFileSync(ddd, "utf8"))); }
  try { return execFileSync("node", ["bin/cli.js", "parse", src], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { return (e.stdout || "") + (e.stderr || ""); }
}
const checks = [];
const check = (id, fn) => checks.push({ id, fn });

check("F-009 toast — per-frontend, checking the PAGE's own imports", () => {
  const out = [];
  for (const fw of ["react", "vue", "svelte", "angular", "elixir", "flutter"]) {
    const o = `/tmp/rv2/f009-${fw}`;
    try {
      gen("sweep/repro/F-009-toast-in-action.ddd", o, s => {
        if (fw === "elixir") {
          s = s.replace(/  deployable api \{[\s\S]*?\n  \}\n/, `  deployable api {\n    platform: elixir\n    contexts: [C]\n    dataSources: [cs]\n    serves: CApi\n    ui: W { C: api }\n    port: 4000\n  }\n`);
          return s.replace(/  deployable w \{[\s\S]*?\n  \}\n/, "");
        }
        return s.replace("platform: vue, targets", `platform: ${fw}, targets`);
      });
      const root = existsSync(`${o}/w`) ? `${o}/w` : `${o}/api`;
      // ONLY the page/component file that calls toast — does IT declare or import one?
      const callers = grepTree(root, /(?<![.\w$])toast\s*\(/).filter(f => !/\/lib\/|\/i18n|node_modules/.test(f));
      const bad = callers.filter(f => { const s = readFileSync(f, "utf8"); return !/import[^;\n]*\btoast\b|const toast|function toast|useToast|import ApiWeb|def toast/.test(s); });
      out.push(`${fw}: callers=${callers.length} unresolved=${bad.length}`);
    } catch (e) {
      const m = ((e.stderr || "") + (e.stdout || "")).match(/loom\.[a-z-]+/);
      out.push(`${fw}: ${m ? "HONEST " + m[0] : "gen error"}`);
    }
  }
  const broken = out.filter(s => /unresolved=[1-9]/.test(s)).length;
  return { still: broken > 0, note: out.join(" | ") };
});

check("F-020 angular drops component children (HONEST?)", () => {
  const o = "/tmp/rv2/f020";
  const d = diags("sweep/repro/F-015-heex-component-children.ddd", s =>
    s.replace(/  deployable api \{[\s\S]*?\n  \}\n/, `  deployable api {\n    platform: node\n    contexts: [C]\n    dataSources: [cs]\n    serves: CApi\n    port: 3000\n  }\n  deployable w { platform: angular, targets: api, ui: W { C: api }, port: 3001 }\n`));
  const honest = /loom\.component-children-unsupported/.test(d);
  gen("sweep/repro/F-015-heex-component-children.ddd", o, s =>
    s.replace(/  deployable api \{[\s\S]*?\n  \}\n/, `  deployable api {\n    platform: node\n    contexts: [C]\n    dataSources: [cs]\n    serves: CApi\n    port: 3000\n  }\n  deployable w { platform: angular, targets: api, ui: W { C: api }, port: 3001 }\n`));
  const comment = grepTree(`${o}/w/src`, /projected child dropped/).length;
  const orphanKey = grepTree(`${o}/w/src`, /children passed through Slot/).some(f => /locales/.test(f));
  return { still: honest && comment > 0, note: `diagnostic=${honest} inline-comment=${comment > 0} orphan-i18n-key=${orphanKey} (HONEST by design; orphan key is the wart)` };
});

check("F-021 feliz component refusal (HONEST?)", () => {
  const d = diags("sweep/models/probe-ui.ddd", s => s
    .replaceAll("__DATAGRID__", "").replaceAll("__PROVENANCE__", "").replaceAll("__UI_FRAMEWORK__", "")
    .replaceAll("__FRONTEND__", "feliz").replaceAll("__FRONTEND_EXTRA__", ""));
  const m = d.match(/loom\.user-component-deferred-target/);
  return { still: !!m, note: m ? "still refuses, with a named diagnostic (HONEST)" : "no longer refused — feliz may now emit it" };
});

check("F-022 HEEx OperationForm-in-component refusal (HONEST?)", () => {
  const d = diags("sweep/repro/F-015-heex-component-children.ddd", s =>
    s.replace("body: Card { Heading { title, level: 3 }, Slot { } }",
              "body: Card { Heading { title, level: 3 }, OperationForm { of: T, op: touch } }")
     .replace("aggregate T with crudish { label: string }",
              "aggregate T with crudish { label: string  operation touch(n: string) { label := n } }"));
  const m = d.match(/loom\.heex-component-host-state-unsupported/);
  return { still: !!m, note: m ? "still refuses, with a named diagnostic (HONEST)" : "no longer refused / different code: " + (d.match(/loom\.[a-z-]+/) || ["none"])[0] };
});

check("F-023 bare-name match arm mis-parse", () => {
  writeFileSync("/tmp/rv2/m.ddd", `system M {
  subdomain S { context C { aggregate T with crudish { label: string } repository Ts for T { } } }
  api CApi from S
  ui W { api C: CApi
    page P { route: "/"
      state { ok: bool = false }
      body: Stack { match { ok => Badge { "yes" } else => Text { "no" } } } } }
  storage primary { type: postgres }
  resource cs { for: C, kind: state, use: primary }
  deployable api { platform: node, contexts: [C], dataSources: [cs], serves: CApi, port: 3000 }
  deployable w { platform: react, targets: api, ui: W { C: api }, port: 3001 }
}`);
  let d; try { d = execFileSync("node", ["bin/cli.js", "parse", "/tmp/rv2/m.ddd"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { d = (e.stdout || "") + (e.stderr || ""); }
  const misdirected = /Expecting token of type '=>' but found `else`/.test(d);
  return { still: misdirected, note: misdirected ? "bare NameRef arm still mis-parses; the error points at `else`, not the cond" : "parses or reports a clearer error" };
});

check("F-024 CodeBlock highlight.js CDN dependency", () => {
  const o = "/tmp/rv2/f024";
  gen("sweep/repro/F-013-F-014-F-016-display-primitives.ddd", o, s => s
    .replace('Badge { "Beta" },', 'Badge { "Beta" }, CodeBlock { "let x = 1", language: "ts", title: "S" },')
    .replace("platform: vue, targets", "platform: react, targets").replace("design: shadcnVue", "design: shadcn"));
  const hits = grepTree(`${o}/w`, /cdn\.jsdelivr\.net|cdnjs\.cloudflare|unpkg\.com/);
  return { still: hits.length > 0, note: hits.length ? `${hits.length} file(s) reference a public CDN at runtime` : "no CDN reference" };
});

check("F-025 decimal is a JSON number, money a string", () => {
  const o = "/tmp/rv2/f025";
  gen("sweep/repro/F-002-decimal-find-compare.ddd", o, s => s.replace("label: string  weight: decimal", "label: string  weight: decimal  price: money"));
  const routes = grepTree(`${o}/api/http`, /weight/)[0];
  const s = readFileSync(routes, "utf8");
  const weightNum = /weight:\s*z\.number\(\)/.test(s);
  const priceStr = /price:\s*moneySchema/.test(s);
  return { still: weightNum && priceStr, note: `decimal→z.number()=${weightNum}, money→moneySchema(string)=${priceStr}` };
});

check("F-027 pack-namespaced i18n keys churn on a pack swap", () => {
  const keys = {};
  for (const pack of ["shadcn", "mui"]) {
    const o = `/tmp/rv2/f027-${pack}`;
    gen("sweep/repro/F-007-two-forms-one-page.ddd", o, s => s.replace("design: shadcn", `design: ${pack}`));
    const f = walk(`${o}/web_app/src`).find(x => /locales\/en\.json$/.test(x));
    keys[pack] = Object.keys(JSON.parse(readFileSync(f, "utf8")));
  }
  const only = (a, b) => keys[a].filter(k => !keys[b].includes(k));
  return { still: only("shadcn", "mui").length > 0, note: `shadcn-only=${only("shadcn","mui").length} mui-only=${only("mui","shadcn").length} (all pack.<name>.* — by design, but a swap invalidates that slice of a translator's catalog)` };
});

check("F-030 workflow response shape: elixir vs the rest", () => {
  const shapes = {};
  for (const be of ["node", "dotnet", "java", "python", "elixir"]) {
    const o = `/tmp/rv2/f030-${be}`;
    gen("sweep/repro/F-003-svelte-workflow-formstate.ddd", o, s => {
      s = s.replace("platform: node,", `platform: ${be},`).replace("port: 3000", be === "elixir" ? "port: 4000" : "port: 3000");
      return s.replace(/  deployable webApp \{[\s\S]*?\n  \}\n/, "");
    });
    const root = `${o}/api`;
    const wf = grepTree(root, /rename|Rename/i).filter(f => /workflow|controller|routes|Workflow/i.test(f));
    const src = wf.map(f => readFileSync(f, "utf8")).join("\n");
    shapes[be] = /202|:accepted|"accepted"/.test(src) ? "202/accepted+body" : /204|NoContent|no_content/.test(src) ? "204 empty" : "unknown";
  }
  const set = new Set(Object.values(shapes));
  return { still: set.size > 1, note: Object.entries(shapes).map(([k, v]) => `${k}=${v}`).join(" ") };
});

for (const { id, fn } of checks) {
  let r; try { r = fn(); } catch (e) { r = { still: null, note: "ERRORED: " + String(e).split("\n")[0].slice(0, 200) }; }
  console.log(`${r.still === true ? "STILL-BUG" : r.still === false ? "FIXED    " : "UNKNOWN  "} ${id}\n            ${r.note}`);
}

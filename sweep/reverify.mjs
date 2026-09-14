// Re-verify each sweep finding against whatever `main` is checked out now.
// Each check GENERATES from the committed repro and greps the emitted source for
// the exact defect signature. Source-level only — compile/runtime cells are
// re-run separately.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, rmSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const gen = (ddd, out, mutate) => {
  rmSync(out, { recursive: true, force: true });
  let src = ddd;
  if (mutate) {
    src = `/tmp/rv/${out.split("/").pop()}.ddd`;
    writeFileSync(src, mutate(readFileSync(ddd, "utf8")));
  }
  execFileSync("node", ["bin/cli.js", "generate", "system", src, "-o", out],
    { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  return out;
};
const walk = (d, a = []) => { for (const e of readdirSync(d)) { const p = join(d, e); statSync(p).isDirectory() ? walk(p, a) : a.push(p); } return a; };
const grepTree = (dir, re) => walk(dir).filter(f => { try { return re.test(readFileSync(f, "utf8")); } catch { return false; } });

const checks = [];
const check = (id, fn) => checks.push({ id, fn });

check("F-002 decimal find compare (node)", () => {
  const o = gen("sweep/repro/F-002-decimal-find-compare.ddd", "/tmp/rv/f002");
  const s = readFileSync(`${o}/api/db/repositories/thing-repository.ts`, "utf8");
  const m = s.match(/async heavierThan\(limit: (\w+)\)[\s\S]{0,300}?where\((\w+)\(schema\.things\.weight,\s*(\w+)\)\)/);
  return m ? { still: true, note: `limit: ${m[1]} compared via ${m[2]}(numeric-col, ${m[3]})` }
           : { still: false, note: "emission changed — inspect " + o };
});

check("F-003 svelte workflow money FormState", () => {
  const o = gen("sweep/repro/F-003-svelte-workflow-formstate.ddd", "/tmp/rv/f003");
  const pages = grepTree(`${o}/web_app/src`, /FormState/);
  if (!pages.length) return { still: false, note: "no FormState import emitted at all" };
  const api = readFileSync(`${o}/web_app/src/lib/api/workflows.ts`, "utf8");
  const exported = /export (type|interface) \w*FormState/.test(api);
  return { still: !exported, note: exported ? "FormState now exported" : `imported by ${pages.length} page(s), never exported` };
});

check("F-004 angular string[] FormControl(null)", () => {
  const o = gen("sweep/repro/F-004-angular-collection-field-null.ddd", "/tmp/rv/f004");
  const hits = grepTree(`${o}/web_app/src`, /tags: new FormControl\(null/);
  return { still: hits.length > 0, note: hits.length ? `${hits.length} file(s): tags: new FormControl(null, {nonNullable:true})` : "no null-seeded array control" };
});

check("F-005 elixir currentUser find", () => {
  const o = gen("sweep/repro/F-005-elixir-currentuser-find.ddd", "/tmp/rv/f005");
  const hits = grepTree(`${o}/api/lib`, /where:.*\bcurrent_user\./);
  return { still: hits.length > 0, note: hits.length ? `bare current_user in ${hits.length} Ecto query` : "current_user no longer bare" };
});

check("F-006 flutter missing find providers", () => {
  const o = gen("sweep/repro/F-006-flutter-missing-find-providers.ddd", "/tmp/rv/f006");
  const used = new Set(walk(`${o}/web_app/lib/pages`).flatMap(f => [...readFileSync(f, "utf8").matchAll(/\b([a-z][A-Za-z0-9]*Provider)\b/g)].map(m => m[1])));
  const defined = new Set(walk(`${o}/web_app/lib`).flatMap(f => [...readFileSync(f, "utf8").matchAll(/final ([a-z][A-Za-z0-9]*Provider)\b/g)].map(m => m[1])));
  const missing = [...used].filter(p => !defined.has(p) && !/^(Notifier|Future|State|Stream)Provider$/.test(p));
  return { still: missing.length > 0, note: missing.length ? `dangling: ${missing.join(", ")}` : "every provider used is defined" };
});

check("F-007 two forms one page (react)", () => {
  const o = gen("sweep/repro/F-007-two-forms-one-page.ddd", "/tmp/rv/f007");
  const f = `${o}/web_app/src/pages/two_forms.tsx`;
  if (!existsSync(f)) return { still: null, note: "page path changed" };
  const s = readFileSync(f, "utf8");
  const decls = [...s.matchAll(/^\s*const \{?\s*([\w,\s:]+?)\s*\}?\s*=\s*use(Form|Mutation)/gm)].map(m => m[0].trim());
  const names = [...s.matchAll(/^\s*const (\w+) = useForm/gm)].map(m => m[1]);
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  return { still: dup.length > 0, note: dup.length ? `duplicate const ${[...new Set(dup)].join(",")} in one scope (${names.length} useForm calls)` : `${names.length} useForm call(s), distinct names` };
});

check("F-008 mantine chart braces", () => {
  const o = gen("sweep/repro/F-008-mantine-chart-braces.ddd", "/tmp/rv/f008");
  const hits = grepTree(`${o}/web_app/src`, /yAxisProps=\{\{\{/);
  const tmpl = readFileSync("designs/mantine/v9/primitive-chart.hbs", "utf8");
  return { still: hits.length > 0, note: hits.length ? "emits yAxisProps={{{ … }} (3 opens, 2 closes)" : (/yAxisProps=\{\\\{\{/.test(tmpl) ? "template still has =\\{{ but did not fire" : "template fixed") };
});

const TOAST_TARGETS = [["react", /toast/], ["vue", /toast/], ["svelte", /toast/], ["angular", /toast/], ["elixir", /toast/], ["flutter", /toast/]];
check("F-009 toast() in action body", () => {
  const notes = [];
  for (const [fw] of TOAST_TARGETS) {
    const out = `/tmp/rv/f009-${fw}`;
    let declared = null, refused = false;
    try {
      gen("sweep/repro/F-009-toast-in-action.ddd", out, s => {
        if (fw === "elixir") {
          s = s.replace(/  deployable api \{[\s\S]*?\n  \}\n/, `  deployable api {\n    platform: elixir\n    contexts: [C]\n    dataSources: [cs]\n    serves: CApi\n    ui: W { C: api }\n    port: 4000\n  }\n`);
          return s.replace(/  deployable w \{[\s\S]*?\n  \}\n/, "");
        }
        return s.replace("platform: vue, targets", `platform: ${fw}, targets`);
      });
      const root = existsSync(`${out}/w`) ? `${out}/w` : `${out}/api`;
      const srcDir = existsSync(`${root}/src`) ? `${root}/src` : existsSync(`${root}/lib`) ? `${root}/lib` : root;
      const uses = grepTree(srcDir, /(?<![.\w])toast\s*\(/);
      const decl = grepTree(srcDir, /(import[^;\n]*\btoast\b|const toast|function toast|def toast|defp toast|useToast|toast:)/);
      declared = decl.length > 0;
      notes.push(`${fw}: uses=${uses.length} declared=${declared}`);
    } catch (e) {
      const msg = ((e.stderr || "") + (e.stdout || ""));
      refused = /loom\./.test(msg);
      notes.push(`${fw}: ${refused ? "HONEST refusal (" + (msg.match(/loom\.[a-z-]+/) || [""])[0] + ")" : "gen failed"}`);
    }
  }
  const broken = notes.filter(n => /uses=[1-9].*declared=false/.test(n));
  return { still: broken.length > 0, note: notes.join(" | ") };
});

check("F-010/F-011 DestroyForm (vue/svelte)", () => {
  const notes = [];
  for (const fw of ["vue", "svelte"]) {
    const out = `/tmp/rv/f010-${fw}`;
    gen("sweep/repro/F-010-F-011-destroyform.ddd", out, s => s.replace("platform: vue, targets", `platform: ${fw}, targets`));
    const files = walk(`${out}/w/src`);
    const emptyArrow = files.filter(f => /useDelete\w+\(\(\)\s*=>\s*\)/.test(readFileSync(f, "utf8")));
    const badHandler = files.filter(f => { const s = readFileSync(f, "utf8"); return /['"]onDelete\w+['"]|@click='onDelete\w+'/.test(s) && !/\bconst onDelete\w+|function onDelete\w+/.test(s); });
    notes.push(`${fw}: emptyArrow=${emptyArrow.length} undeclaredHandler=${badHandler.length}`);
  }
  return { still: /=[1-9]/.test(notes.join(" ")), note: notes.join(" | ") };
});

check("F-012 angular error: string literal", () => {
  const o = gen("sweep/repro/F-012-angular-error-string-literal.ddd", "/tmp/rv/f012");
  const hits = grepTree(`${o}/w/src`, /\[attr\.aria-(invalid|describedby)\]="[^"]*"[^"]*"/);
  return { still: hits.length > 0, note: hits.length ? "nested double quotes inside an Angular attribute" : "expression now escaped" };
});

check("F-013 shadcnVue raw <img>", () => {
  const o = gen("sweep/repro/F-013-F-014-F-016-display-primitives.ddd", "/tmp/rv/f013");
  const hits = grepTree(`${o}/w/src`, /<img[^>]*src="\/logo\.png"/);
  return { still: hits.length > 0, note: hits.length ? "raw <img src=\"/logo.png\"> in an SFC template (vite transformAssetUrls turns it into an import)" : "no raw <img> src" };
});

check("F-014 primeng p-select options", () => {
  const o = gen("sweep/repro/F-013-F-014-F-016-display-primitives.ddd", "/tmp/rv/f014",
    s => s.replace("platform: vue, targets", "platform: angular, targets").replace("design: shadcnVue", "design: primeng"));
  const hits = grepTree(`${o}/w/src`, /\[options\]="\[?"/);
  return { still: hits.length > 0, note: hits.length ? '[options]="["…"]" — nested double quotes' : "options now escaped" };
});

check("F-015 HEEx component children duplicate attr", () => {
  const o = gen("sweep/repro/F-015-heex-component-children.ddd", "/tmp/rv/f015");
  const hits = grepTree(`${o}/api/lib`, /\btitle=\{[^}]*\}\s+title=\{/);
  return { still: hits.length > 0, note: hits.length ? "duplicate title= attribute on the component call" : "no duplicate attribute" };
});

check("F-016 .loom-icon emitted but undefined", () => {
  const packs = readdirSync("designs").flatMap(fam => readdirSync(`designs/${fam}`).map(v => `${fam}/${v}`));
  const emit = packs.filter(p => existsSync(`designs/${p}/primitive-icon.hbs`) && /loom-icon/.test(readFileSync(`designs/${p}/primitive-icon.hbs`, "utf8")));
  const define = packs.filter(p => walk(`designs/${p}`).some(f => /\.loom-icon\b/.test(readFileSync(f, "utf8"))));
  const missing = emit.filter(p => !define.includes(p));
  return { still: missing.length > 0, note: `${emit.length} emit the class, ${define.length} define the CSS; missing in ${missing.length}: ${missing.join(" ")}` };
});

check("F-018 Button variant silent fallback", () => {
  const o = gen("sweep/repro/F-018-button-variant-silent-fallback.ddd", "/tmp/rv/f018");
  const page = walk(`${o}/w/src/pages`).find(f => /Primary/.test(readFileSync(f, "utf8")));
  const variants = [...readFileSync(page, "utf8").matchAll(/<Button variant="(\w+)"/g)].map(m => m[1]);
  const ghosts = variants.filter(v => v === "ghost").length;
  return { still: ghosts >= 3, note: `emitted: ${variants.join(", ")} — "filled" and "wombat" both land on ${variants[3]}` };
});

check("F-026 dotnet #line absolute path", () => {
  const o = gen("sweep/repro/F-002-decimal-find-compare.ddd", "/tmp/rv/f026", s => s.replace("platform: node,", "platform: dotnet,").replace("port: 3000", "port: 8080"));
  const hits = grepTree(`${o}/api`, /#line \(\d+,\d+\)-\(\d+,\d+\) "\//);
  return { still: hits.length > 0, note: hits.length ? `${hits.length} file(s) embed the absolute .ddd path` : "no absolute path in #line pragmas" };
});

check("F-029 phoenix Decimal.mult on derived", () => {
  const o = gen("sweep/repro/F-029-elixir-decimal-derived-500.ddd", "/tmp/rv/f029");
  const hits = grepTree(`${o}/api/lib`, /Decimal\.mult\(/);
  const guarded = hits.filter(f => /Decimal\.from_float|to_decimal|cast_decimal/.test(readFileSync(f, "utf8")));
  return { still: hits.length > 0 && guarded.length === 0,
           note: hits.length ? `Decimal.mult in ${hits.length} file(s), from_float guard in ${guarded.length}` : "no Decimal.mult emitted" };
});

check("F-031 mui@v5 MenuIcon deep default import", () => {
  const o = gen("sweep/repro/F-031-mui-v5-blank-app.ddd", "/tmp/rv/f031");
  const app = readFileSync(`${o}/w/src/App.tsx`, "utf8");
  const deep = /import \w+ from "@mui\/icons-material\/\w+"/.test(app);
  return { still: deep, note: deep ? "App.tsx still deep-default-imports @mui/icons-material/<Icon> (CJS on v5)" : "import shape changed" };
});

const results = [];
for (const { id, fn } of checks) {
  let r;
  try { r = fn(); } catch (e) { r = { still: null, note: "CHECK ERRORED: " + String(e).split("\n")[0].slice(0, 160) }; }
  results.push({ id, ...r });
  const tag = r.still === true ? "STILL-BUG" : r.still === false ? "FIXED    " : "UNKNOWN  ";
  console.log(`${tag} ${id}\n            ${r.note}`);
}
console.log("\n--- " + results.filter(r => r.still === true).length + " still bugs, "
  + results.filter(r => r.still === false).length + " fixed, "
  + results.filter(r => r.still === null).length + " inconclusive");

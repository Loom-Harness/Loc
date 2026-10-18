// ---------------------------------------------------------------------------
// IdLink labels a cross-aggregate reference with the referenced record's
// `display` — cross-frontend gate (fleet slice B).
//
// A scaffolded `project: Project id` used to render as a truncated-UUID link
// (`01a0ebe8…`) on every list and detail page, even when `Project` declares
// `derived display` and the create/update picker already labels its options by
// it.  The label could not be a `useProjectById` in the page — the link sits in
// a table-row loop, and a hook per row breaks the rules-of-hooks — so each
// target wraps the pack's truncated-id label in a per-cell CHILD that owns the
// read (TanStack / Riverpod / a promise cache dedupe repeated ids), with the
// truncated id kept as the loading / error / no-display fallback.
//
// What this pins, per frontend:
//   1. a reference to a `display`-carrying aggregate is wrapped, in BOTH the
//      list cell and the detail row, with the truncated id INSIDE the wrap;
//   2. the child's runtime file is emitted and the page imports it;
//   3. the row's link to ITSELF (the scaffold's id column) is NOT wrapped;
//   4. a link to an aggregate WITHOUT `display` keeps today's bytes — no wrap,
//      no runtime file.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const displaySystem = (platform: string): string => `
  system Library {
    subdomain Core {
      context Projects {
        aggregate Project with crudish {
          name: string
          derived display: string = name
        }
        repository Projects for Project { }
        aggregate Task with crudish {
          title: string
          project: Project id
          derived display: string = title
        }
        repository Tasks for Task { }
      }
    }
    ui WebApp with scaffold(subdomains: [Core]) { }
    storage primary { type: postgres }
    resource appState { for: Projects, kind: state, use: primary }
    deployable api { platform: node, contexts: [Projects], dataSources: [appState], port: 3000 }
    deployable web { platform: ${platform}, targets: api, ui: WebApp, port: 3001 }
  }
`;

/** No `display` on `Customer` — so no `X id` FIELD may point at it from a
 *  ui-mounting deployable (`loom.ui-id-ref-no-display`); the only way to link
 *  to one is a hand-written `IdLink`, which is the fallback case. */
const noDisplaySystem = (platform: string): string => `
  system S {
    subdomain M {
      context C {
        aggregate Customer { name: string }
        repository Customers for Customer { }
      }
    }
    ui WebApp {
      page CustomerLink(customerId: string) {
        route: "/customer-link/:customerId"
        body:  IdLink { customerId, of: Customer }
      }
    }
    storage loomDb { type: postgres }
    resource cState { for: C, kind: state, use: loomDb }
    deployable api { platform: node, contexts: [C], dataSources: [cState], port: 3000 }
    deployable web { platform: ${platform}, targets: api, ui: WebApp, port: 3001 }
  }
`;

interface Case {
  target: string;
  /** The runtime file the child lives in. */
  runtime: string;
  /** The wrapped list cell — the truncated id must sit INSIDE the wrap. */
  listWrap: RegExp;
  /** The wrapped detail row. */
  detailWrap: RegExp;
  /** The page-side import of the child. */
  importLine: RegExp;
  /** A wrap around the row's own `id` link (must NOT appear). */
  selfWrap: RegExp;
  /** The wrap's opening token (must not appear in the no-display output). */
  token: string;
}

const CASES: readonly Case[] = [
  {
    target: "react",
    runtime: "web/src/lib/ref-label.tsx",
    listWrap:
      /<LoomRefLabel path="\/projects\/" id=\{ row\.project \}><IdValue id=\{ row\.project \} \/><\/LoomRefLabel>/,
    detailWrap:
      /<LoomRefLabel path="\/projects\/" id=\{ taskById\.data\.project \}><IdValue id=\{ taskById\.data\.project \} \/><\/LoomRefLabel>/,
    importLine: /import \{ LoomRefLabel \} from "\.\.\/\.\.\/lib\/ref-label";/,
    selfWrap: /<LoomRefLabel path="\/tasks\/"/,
    token: "LoomRefLabel",
  },
  {
    target: "vue",
    runtime: "web/src/components/LoomRefLabel.vue",
    listWrap:
      /<LoomRefLabel path="\/projects\/" :id="row\.project">\{\{ shortId\(row\.project\) \}\}<\/LoomRefLabel>/,
    detailWrap: /<LoomRefLabel path="\/projects\/" :id="taskById\.data\.project">/,
    importLine: /import LoomRefLabel from "\.\.\/\.\.\/components\/LoomRefLabel\.vue";/,
    selfWrap: /<LoomRefLabel path="\/tasks\/"/,
    token: "LoomRefLabel",
  },
  {
    target: "svelte",
    runtime: "web/src/lib/components/LoomRefLabel.svelte",
    listWrap:
      /<LoomRefLabel path="\/projects\/" id=\{ row\.project \}><code[^>]*>\{formatId\(row\.project\)\}<\/code><\/LoomRefLabel>/,
    detailWrap: /<LoomRefLabel path="\/projects\/" id=\{ taskById\.data\.project \}>/,
    importLine: /import LoomRefLabel from "\$lib\/components\/LoomRefLabel\.svelte";/,
    selfWrap: /<LoomRefLabel path="\/tasks\/"/,
    token: "LoomRefLabel",
  },
  {
    target: "angular",
    runtime: "web/src/lib/ref-label.ts",
    listWrap:
      /<loom-ref-label path="\/projects\/" \[refId\]='row\.project'>\{\{ shortId\(row\.project\) \}\}<\/loom-ref-label>/,
    detailWrap: /<loom-ref-label path="\/projects\/" \[refId\]='taskById\.data\(\)!\.project'>/,
    importLine:
      /import \{ LoomRefLabel \} from "\.\.\/\.\.\/lib\/ref-label";[\s\S]*imports: \[[^\]]*\bLoomRefLabel\b/,
    selfWrap: /<loom-ref-label path="\/tasks\/"/,
    token: "loom-ref-label",
  },
  {
    target: "feliz",
    runtime: "web/src/App.fs",
    listWrap:
      /prop\.children \[ LoomRefLabel\.view "\/projects\/" \(row\.project\) \(Html\.text \(string \(row\.project\)\)\) \]/,
    detailWrap: /LoomRefLabel\.view "\/projects\/" \(taskById\.project\)/,
    importLine: /module LoomRefLabel =/,
    selfWrap: /LoomRefLabel\.view "\/tasks\/"/,
    token: "LoomRefLabel",
  },
  {
    target: "flutter",
    runtime: "web/lib/ref_label.dart",
    listWrap:
      /child: LoomRefLabel\(path: '\/projects\/\$\{row\.project\}', fallback: Text\(row\.project\.toString\(\)\)\)/,
    detailWrap: /LoomRefLabel\(path: '\/projects\/\$\{taskById\.project\}'/,
    importLine: /import '\.\.\/ref_label\.dart';/,
    selfWrap: /LoomRefLabel\(path: '\/tasks\//,
    token: "LoomRefLabel",
  },
];

function allFiles(files: Map<string, string>): string {
  let all = "";
  for (const content of files.values()) all += `\n${content}`;
  return all;
}

describe("IdLink — a reference to a `display`-carrying aggregate renders its label", () => {
  for (const c of CASES) {
    it(`${c.target}: list + detail wrap the truncated id in the per-cell label child`, async () => {
      const files = await generateSystemFiles(displaySystem(c.target));
      const out = allFiles(files);
      expect(out).toMatch(c.listWrap);
      expect(out).toMatch(c.detailWrap);
      expect(out).toMatch(c.importLine);
      // The runtime is emitted, and it reads the wire `display`.
      expect(files.get(c.runtime), `${c.runtime} emitted`).toBeDefined();
      expect(files.get(c.runtime)).toContain("display");
      // The scaffold's id column links the row to ITSELF — no by-id read there.
      expect(out).not.toMatch(c.selfWrap);
    });

    it(`${c.target}: a link to an aggregate WITHOUT display keeps the truncated id, no child`, async () => {
      const files = await generateSystemFiles(noDisplaySystem(c.target));
      const out = allFiles(files);
      expect(out).toContain("/customers/");
      expect(out).not.toContain(c.token);
      if (c.target !== "feliz") expect(files.get(c.runtime)).toBeUndefined();
    });
  }
});

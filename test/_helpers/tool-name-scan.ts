// The tool name in generated output — one extraction, shared by the corpus
// census and the fast-tier guard (`test/system/tool-name-census*.test.ts`).
//
// Generated projects carry no tool name (D-NO-TOOL-NAME).  This turns a
// generated file tree into the set of NAMES under which the tool name still
// appears, so the census can hold that set against a shrink-only allowlist.
//
// A name is the identifier-shaped run around a case-insensitive `loom`
// (`[A-Za-z0-9_$-]`), normalised so that one emitted name is one entry however
// many apps it appears in:
//   - a bare `loom` followed by `.ident` or `:ident` keeps that segment
//     (`loom.correlation_id`, the Helm helper `loom.fullname`, the
//     `loom:scaffold-once` marker); a `loom.<code>` that is a diagnostic-catalog
//     code collapses to `loom.<diagnostic-code>`;
//   - the Java base package `com.loom.<app>` collapses to `com.loom`;
//   - a file-path occurrence is prefixed `path:` (directory `com/loom/` →
//     `path:com/loom`).
//   - a bare `loom` splits by syntax: `"loom"` (a string literal), `:loom` (an
//     Elixir atom), `/loom` (the broker vhost, the CloudEvents `source`),
//     `managed-by: loom` (the Kubernetes label), and otherwise `loom` / `Loom`
//     (prose, mostly comments).
// Out of scope by ruling, and never counted: everything under `.loom/` (the
// compiler's artifact bundle, path and content) and a `.loom/` reference inside
// a file.  A name the user's own model spells — a system called `LoomLanding`,
// an OIDC client id `"loom-console"` — is the user's, not the tool's: a name
// whose letters (case and punctuation folded) appear in the `.ddd` source is
// skipped for that source.

import {
  DESIGN_PACKS,
  packFormatOf,
  renderStarter,
  STARTER_PLATFORMS,
} from "../../src/cli/new-templates.js";
import { DIAGNOSTIC_MESSAGES } from "../../src/diagnostics/messages.js";

const TOKEN = /[A-Za-z0-9_$-]*loom[A-Za-z0-9_$-]*/gi;

const DIAGNOSTIC_CODES: ReadonlySet<string> = new Set(
  Object.keys(DIAGNOSTIC_MESSAGES).map((k) => k.replace(/#.*$/, "")),
);

/** Is `path` part of the `.loom/` artifact bundle (out of scope)? */
export function isLoomBundlePath(path: string): boolean {
  return path.startsWith(".loom/") || path.includes("/.loom/");
}

function fold(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The names one line (or one path) carries. */
export function namesIn(text: string, isPath: boolean): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const tok = m[0];
    const start = m.index ?? 0;
    const end = start + tok.length;
    const before = text.slice(Math.max(0, start - 4), start);
    const after = text.slice(end);
    if (/^loom$/i.test(tok)) {
      // `.loom/…` — the artifact bundle, out of scope.
      if (before.endsWith(".") && after.startsWith("/")) continue;
      // `com.loom.<app>` / `com/loom/<app>` — the Java base package.
      if (/com[./]$/.test(before)) {
        out.push(isPath ? "path:com/loom" : "com.loom");
        continue;
      }
      const seg = /^([.:])([A-Za-z_][A-Za-z0-9_-]*)/.exec(after);
      if (seg && !isPath) {
        const dotted = `${tok}${seg[1]}${seg[2]}`;
        out.push(DIAGNOSTIC_CODES.has(dotted) ? "loom.<diagnostic-code>" : dotted);
        continue;
      }
      if (!isPath) {
        // A bare `loom` is a string literal (`getTracer("loom")`), an Elixir
        // atom (`[:loom, :domain, :fault]`), or prose — three different names.
        if (text.slice(Math.max(0, start - 12), start) === "managed-by: ")
          out.push(`managed-by: ${tok}`);
        else if (/["']$/.test(before) && /^["']/.test(after)) out.push(`"${tok}"`);
        else if (before.endsWith(":") && !before.endsWith("::")) out.push(`:${tok}`);
        else if (before.endsWith("/")) out.push(`/${tok}`);
        else out.push(tok);
        continue;
      }
    }
    out.push(isPath ? `path:${tok}` : tok);
  }
  return out;
}

export interface ToolNameHit {
  readonly count: number;
  /** A few `file :: line` samples, for the failure message. */
  readonly samples: string[];
}

/** Every tool-named NAME in one generated tree, with occurrence counts.
 *  `dddSource` is the model the tree was generated from (user-origin filter). */
export function toolNamesInTree(
  files: ReadonlyMap<string, string>,
  dddSource: string,
  into: Map<string, ToolNameHit> = new Map(),
): Map<string, ToolNameHit> {
  const userText = fold(dddSource.replace(/(^|\s)\/\/.*$/gm, "$1"));
  const add = (name: string, where: string) => {
    if (userText.includes(fold(name.replace(/^path:/, "")))) return;
    const hit = into.get(name) ?? { count: 0, samples: [] };
    if (hit.samples.length < 3) hit.samples.push(where);
    into.set(name, { count: hit.count + 1, samples: hit.samples });
  };
  for (const [path, content] of files) {
    if (isLoomBundlePath(path)) continue;
    for (const n of namesIn(path, true)) add(n, path);
    if (!/loom/i.test(content)) continue;
    for (const line of content.split("\n")) {
      if (!/loom/i.test(line)) continue;
      for (const n of namesIn(line, false)) add(n, `${path} :: ${line.trim().slice(0, 160)}`);
    }
  }
  return into;
}

/** The allowlist row a name falls under: an exact `name` row first, then the
 *  first `pattern` row whose regex matches it. */
export function allowlistRowOf<
  E extends { readonly name: string } | { readonly pattern: string; readonly shows: string },
>(name: string, rows: readonly E[]): E | undefined {
  return (
    rows.find((r) => "name" in r && r.name === name) ??
    rows.find((r) => "pattern" in r && new RegExp(r.pattern).test(name))
  );
}

/** How a row reads in a failure message. */
export function rowLabel(r: { readonly name: string } | { readonly shows: string }): string {
  return "name" in r ? r.name : r.shows;
}

/** The `ddd new --template crud` starter on every backend × every design pack
 *  `ddd new` accepts for it (a LiveView pack only on elixir) — the combination
 *  space that reaches every design pack's emitted chrome. */
export function starterSources(): { label: string; source: string }[] {
  const out: { label: string; source: string }[] = [];
  for (const design of DESIGN_PACKS) {
    for (const platform of STARTER_PLATFORMS) {
      if (packFormatOf(design) === "heex" && platform !== "elixir") continue;
      out.push({
        label: `ddd new --platform ${platform} --design ${design}`,
        source: renderStarter({
          name: "demo",
          template: "crud",
          platform,
          design,
          invocation: "ddd",
        }),
      });
    }
  }
  return out;
}

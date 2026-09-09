// ---------------------------------------------------------------------------
// Elixir / Phoenix (vanilla Ecto) — a `paged` find's ARITY agrees across the
// three modules that hand the call to each other, on EVERY storage shape.
//
// The paged carrier is threaded by three separate emitters:
//
//   * the controller's paged action calls `<Ctx>.<find>_<agg>(args…, page,
//     page_size, sort, dir[, current_user])`  (`find-controller.ts`);
//   * the context module `defdelegate`s that arity to the repository
//     (`context-emit.ts`, and `eventsourced-emit.ts` for an ES aggregate);
//   * the repository DEFINES the function (`repository-emit.ts` for the
//     relational/embedded shapes, `document-emit.ts` for `shape: document`,
//     `eventsourced-emit.ts` for `persistedAs: eventLog`).
//
// Only the relational builder ever declared all four page arguments.  The
// document builder declared `page`/`page_size` and dropped `sort`/`dir`; the
// event-sourced builder dropped the carrier entirely while the controller kept
// paging.  Elixir has no compiler check at the DEFINITION site for either — the
// mismatch surfaces only when the delegate/call site is compiled, as
// `D.Main.ThingRepository.by_label/5 is undefined or private`, which
// `mix compile --warnings-as-errors` turns into a failed build.
//
// That is pairwise finding F14 (`compile oracle (elixir)` on `main` @ 123d30e7,
// #2797): it was found by READING the emitted source and never got a waiver,
// because the leg that proves it costs ~78 minutes of docker.  This test is the
// cheap oracle for the same class — it derives the arities from the emitted
// text instead of pinning strings, so a fifth shape or a new page argument is
// covered the day it is emitted.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

/** Every storage shape, each with a `paged` declared find. */
const SHAPES = `system Pg {
  subdomain Core {
    context Main {
      aggregate Rel with crudish {
        label: string
        amount: int = 0
      }
      aggregate Doc shape: document, with crudish {
        label: string
        amount: int = 0
      }
      aggregate Emb shape: embedded, with crudish {
        label: string
        contains lines: Line[]
        entity Line { sku: string }
      }
      event Opened { evt: Evt id, label: string }
      aggregate Evt persistedAs: eventLog {
        label: string
        amount: int = 0
        create open(label: string) { emit Opened { evt: id, label: label } }
        apply(e: Opened) { label := e.label  amount := 0 }
      }
      repository Rels for Rel { find byLabel(l: string): Rel paged where this.label == l }
      repository Docs for Doc { find byLabel(l: string): Doc paged where this.label == l }
      repository Embs for Emb { find byLabel(l: string): Emb paged where this.label == l }
      repository Evts for Evt { find byLabel(l: string): Evt paged where this.label == l }
    }
  }
  api MainApi from Core
  storage primary { type: postgres }
  resource mainState { for: Main, kind: state, use: primary }
  resource mainLog { for: Main, kind: eventLog, use: primary }
  deployable d {
    platform: elixir
    contexts: [Main]
    dataSources: [mainState, mainLog]
    serves: MainApi
    port: 4000
  }
}`;

/** The principal-scoped half — a `tenantOwned` aggregate threads
 *  `current_user` AFTER the four page arguments, so the trailing-actor arity is
 *  part of the same agreement. */
const SCOPED = `system PgScoped {
  user { id: guid  role: string  tenantId: string }
  tenancy by user.tenantId of Org
  subdomain Core {
    context Main {
      aggregate Doc shape: document, with crudish, tenantOwned {
        label: string
      }
      repository Docs for Doc { find byLabel(l: string): Doc paged where this.label == l }
    }
    context Registry {
      aggregate Org with crudish {
        name: string
        implements tenantRegistry
      }
      repository Orgs for Org { }
    }
  }
  api MainApi from Core
  storage primary { type: postgres }
  resource mainState { for: Main, kind: state, use: primary }
  resource registryState { for: Registry, kind: state, use: primary }
  deployable d {
    platform: elixir
    contexts: [Main, Registry]
    dataSources: [mainState, registryState]
    serves: MainApi
    port: 4000
    auth: required
  }
}`;

/** Split an Elixir argument list at top-level commas (parens/brackets/braces
 *  and string literals nest, so `Map.get(params, "sort", "id")` is ONE arg). */
function splitArgs(src: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inStr = false;
  let cur = "";
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      cur += ch;
      if (ch === '"' && src[i - 1] !== "\\") inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      cur += ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim() !== "") out.push(cur.trim());
  return out;
}

/** The balanced argument text starting at the `(` at `open`. */
function argsAt(line: string, open: number): string {
  let depth = 0;
  for (let i = open; i < line.length; i++) {
    if (line[i] === "(") depth++;
    else if (line[i] === ")") {
      depth--;
      if (depth === 0) return line.slice(open + 1, i);
    }
  }
  return "";
}

/** Arity range a `def`/`defdelegate` head accepts — `\\ default` arguments are
 *  optional, so a head of `(l, page \\ 1)` answers to /1 and /2. */
function arityRange(args: string): { min: number; max: number } {
  const parts = splitArgs(args);
  const optional = parts.filter((p) => p.includes("\\\\")).length;
  return { min: parts.length - optional, max: parts.length };
}

interface Emitted {
  /** module → fn name → accepted arity ranges. */
  readonly defs: Map<string, Map<string, { min: number; max: number }[]>>;
  /** every `defdelegate` seen, with the module it points at. */
  readonly delegates: { module: string; target: string; arity: { min: number; max: number } }[];
  /** every `<Module>.<fn>(…)` call in a controller. */
  readonly calls: { module: string; fn: string; arity: number; where: string }[];
}

/** Read the emitted Elixir back as (module, function, arity) facts. */
function readElixir(files: Map<string, string>): Emitted {
  const defs = new Map<string, Map<string, { min: number; max: number }[]>>();
  const delegates: Emitted["delegates"] = [];
  const calls: Emitted["calls"] = [];
  for (const [path, content] of files) {
    if (!path.endsWith(".ex")) continue;
    let module = "";
    for (const line of content.split("\n")) {
      const mod = /^\s*defmodule\s+([A-Z][\w.]*)\s+do/.exec(line);
      if (mod) {
        module = mod[1];
        continue;
      }
      const del = /^\s*defdelegate\s+([a-z_][\w?!]*)\(/.exec(line);
      if (del) {
        const to = /,\s*to:\s*([A-Z][\w.]*)/.exec(line);
        const as = /,\s*as:\s*:([a-z_][\w?!]*)/.exec(line);
        if (to) {
          delegates.push({
            module: to[1],
            target: as ? as[1] : del[1],
            arity: arityRange(argsAt(line, line.indexOf("(", line.indexOf(del[1])))),
          });
        }
        continue;
      }
      // `def list do` / `def list, do: …` are zero-arity heads written without
      // parentheses — a def-shape the emitters use for every parameterless read.
      const bare = /^\s*defp?\s+([a-z_][\w?!]*)\s*(do\b|,\s*do:)/.exec(line);
      if (bare) {
        if (!defs.has(module)) defs.set(module, new Map());
        const byName = defs.get(module) as Map<string, { min: number; max: number }[]>;
        byName.set(bare[1], [...(byName.get(bare[1]) ?? []), { min: 0, max: 0 }]);
        continue;
      }
      const def = /^\s*defp?\s+([a-z_][\w?!]*)\(/.exec(line);
      if (def) {
        const range = arityRange(argsAt(line, line.indexOf("(", line.indexOf(def[1]))));
        if (!defs.has(module)) defs.set(module, new Map());
        const byName = defs.get(module) as Map<string, { min: number; max: number }[]>;
        byName.set(def[1], [...(byName.get(def[1]) ?? []), range]);
        continue;
      }
      // A controller's call INTO the context façade — `Main.by_label_doc(…)`.
      for (const m of line.matchAll(/\b([A-Z][\w.]*)\.([a-z_][\w?!]*)\(/g)) {
        const open = line.indexOf("(", (m.index ?? 0) + m[0].length - 1);
        const args = argsAt(line, open);
        calls.push({
          module: m[1],
          fn: m[2],
          arity: args.trim() === "" ? 0 : splitArgs(args).length,
          where: path,
        });
      }
    }
  }
  return { defs, delegates, calls };
}

const accepts = (ranges: { min: number; max: number }[] | undefined, arity: number): boolean =>
  !!ranges?.some((r) => arity >= r.min && arity <= r.max);

describe("elixir paged finds — arity agrees across repository / context / controller", () => {
  for (const [label, source] of [
    ["every storage shape", SHAPES],
    ["a principal-scoped document read", SCOPED],
  ] as const) {
    it(`${label}: every defdelegate lands on a function the target module defines`, async () => {
      const files = await generateSystemFiles(source);
      const { defs, delegates } = readElixir(files);
      const broken = delegates
        .filter((d) => defs.has(d.module))
        .filter((d) => {
          const ranges = defs.get(d.module)?.get(d.target);
          // The delegate's own head is a RANGE too (defaults); every arity it
          // can be called at must resolve.
          for (let a = d.arity.min; a <= d.arity.max; a++) {
            if (!accepts(ranges, a)) return true;
          }
          return false;
        })
        .map((d) => `${d.module}.${d.target}/${d.arity.min}..${d.arity.max}`);
      expect(broken).toEqual([]);
    });

    it(`${label}: every context call from a controller resolves`, async () => {
      const files = await generateSystemFiles(source);
      const { defs, delegates, calls } = readElixir(files);
      // The context module's public surface = its own defs + its defdelegates.
      const contextFns = new Map<string, { min: number; max: number }[]>();
      for (const [module, byName] of defs) {
        if (module !== "D.Main") continue;
        for (const [fn, ranges] of byName) contextFns.set(fn, ranges);
      }
      for (const [path, content] of files) {
        if (!/lib\/d\/main\.ex$/.test(path)) continue;
        for (const line of content.split("\n")) {
          const del = /^\s*defdelegate\s+([a-z_][\w?!]*)\(/.exec(line);
          if (!del) continue;
          const range = arityRange(argsAt(line, line.indexOf("(", line.indexOf(del[1]))));
          contextFns.set(del[1], [...(contextFns.get(del[1]) ?? []), range]);
        }
      }
      expect(delegates.length).toBeGreaterThan(0);
      const unresolved = calls
        .filter((c) => c.module === "Main" && c.fn.startsWith("by_label"))
        .filter((c) => !accepts(contextFns.get(c.fn), c.arity))
        .map((c) => `${c.module}.${c.fn}/${c.arity} (${c.where})`);
      expect(unresolved).toEqual([]);
    });
  }

  it("a paged find declares page/page_size/sort/dir on every shape", async () => {
    const files = await generateSystemFiles(SHAPES);
    const heads: string[] = [];
    for (const [path, content] of files) {
      if (!/_repository\.ex$/.test(path)) continue;
      for (const line of content.split("\n")) {
        if (/^\s*def by_label\(/.test(line)) heads.push(`${path}::${line.trim()}`);
      }
    }
    // One per shape — relational, document, embedded, event-sourced.
    expect(heads).toHaveLength(4);
    for (const head of heads) {
      expect(head).toMatch(/page \\\\ 1/);
      expect(head).toMatch(/page_size \\\\ 20/);
      expect(head).toMatch(/sort \\\\ "id"/);
      expect(head).toMatch(/dir \\\\ "asc"/);
    }
  });
});

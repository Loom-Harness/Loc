// Every dependency in a generated project manifest is pinned to ONE exact
// version — no `^`/`~`/`>=`/`~>`/open range — across the whole tracked `.ddd`
// corpus on all five backends and every built-in design pack.
//
// The class: a range resolves at install time, so a generated project that built
// yesterday fails today when a dependency ships a breaking release inside its
// range (the postgrex `>= 0.0.0` case, the `@hono/zod-openapi` 1.5.2 type
// regression, npm packuments cached before a newer matching version existed).
// No lockfile is emitted, so the manifest is the only place the resolved set can
// be pinned; transitive dependencies still float.
//
// Manifests read, per ecosystem:
//   - `package.json`        dependencies / devDependencies / peer / optional
//   - `*.csproj`/`*.fsproj` PackageReference `Version`
//   - `build.gradle.kts`    plugin `version "…"` and `"group:artifact:version"`
//   - `pyproject.toml`      the dependency arrays and `[build-system] requires`
//   - `mix.exs`             `{:name, "req"}` tuples
//   - `pubspec.yaml`        `dependencies` / `dev_dependencies`
// Environment constraints (`engines`, `requires-python`, the Dart/Flutter `sdk`
// range, `<TargetFramework>`) are not dependencies and are not read.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILTIN_PACK_LATEST, packFormatForBuiltin } from "../../src/util/builtin-formats.js";
import { REPO_ROOT, trackedDddFiles, UNPARSEABLE_DDD } from "../_helpers/ddd-corpus.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { BACKENDS, PLATFORM_CLAUSE } from "../fixtures/corpus/backends.js";

const EXACT = /^\d+(\.\d+){1,3}([.-][0-9A-Za-z]+)*$/;

/** A dependency the manifest may not pin exactly, with the reason.  Keyed
 *  `<manifest basename>:<name>`.  A stale entry (no longer a range anywhere in
 *  the sweep) fails the ratchet below, so the fix deletes its waiver. */
const WAIVERS: Record<string, string> = {
  "pubspec.yaml:intl":
    "Flutter's `flutter_localizations` pins `intl` from the SDK, and the generated image tracks `flutter:stable`; an exact value is only knowable once the SDK is pinned.",
};

/** Waived pins no corpus fixture reaches (the ratchet cannot observe them), each
 *  pinned verbatim by the suite named here instead. */
const WAIVED_ELSEWHERE: Record<string, string> = {
  "pubspec.yaml:web":
    "`flutter_web_plugins` pins `web` from the SDK (same floating-SDK constraint as `intl`); emitted only for a Flutter realtime handler — test/generator/flutter/realtime.test.ts asserts it.",
};

interface Pin {
  readonly name: string;
  readonly spec: string;
}

function packageJsonPins(text: string): Pin[] {
  const j = JSON.parse(text) as Record<string, unknown>;
  const out: Pin[] = [];
  for (const sec of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    const deps = j[sec];
    if (deps && typeof deps === "object") {
      for (const [name, spec] of Object.entries(deps as Record<string, unknown>)) {
        out.push({ name, spec: String(spec) });
      }
    }
  }
  return out;
}

function dotnetPins(text: string): Pin[] {
  const out: Pin[] = [];
  for (const m of text.matchAll(/<PackageReference\b([^>]*?)\/?>/g)) {
    const attrs = m[1] ?? "";
    const name = /Include="([^"]+)"/.exec(attrs)?.[1];
    const spec = /Version="([^"]+)"/.exec(attrs)?.[1];
    if (name && spec) out.push({ name, spec });
  }
  return out;
}

function gradlePins(text: string): Pin[] {
  const out: Pin[] = [];
  for (const m of text.matchAll(/id\("([^"]+)"\)\s+version\s+"([^"]+)"/g)) {
    out.push({ name: m[1] as string, spec: m[2] as string });
  }
  for (const m of text.matchAll(/"([\w.-]+:[\w.-]+):([^"]+)"/g)) {
    out.push({ name: m[1] as string, spec: m[2] as string });
  }
  return out;
}

function pyprojectPins(text: string): Pin[] {
  const out: Pin[] = [];
  const blocks = text.matchAll(/^(?:dependencies|dev|requires)\s*=\s*\[([\s\S]*?)\]\s*$/gm);
  for (const b of blocks) {
    for (const e of (b[1] ?? "").matchAll(/"([^"]+)"/g)) {
      const entry = e[1] as string;
      const m = /^([A-Za-z0-9_.-]+(?:\[[^\]]*\])?)(.*)$/.exec(entry);
      if (m) out.push({ name: m[1] as string, spec: (m[2] as string).replace(/^==/, "") || "*" });
    }
  }
  return out;
}

function mixPins(text: string): Pin[] {
  const out: Pin[] = [];
  for (const m of text.matchAll(/\{:(\w+),\s*"([^"]+)"/g)) {
    out.push({ name: m[1] as string, spec: (m[2] as string).replace(/^==\s*/, "") });
  }
  return out;
}

function pubspecPins(text: string): Pin[] {
  const out: Pin[] = [];
  let inDeps = false;
  for (const line of text.split("\n")) {
    if (/^(dependencies|dev_dependencies):/.test(line)) {
      inDeps = true;
      continue;
    }
    if (/^\S/.test(line)) inDeps = false;
    const m = inDeps ? /^ {2}([a-z_0-9]+):\s*(\S.*)$/.exec(line) : null;
    if (m) out.push({ name: m[1] as string, spec: (m[2] as string).trim() });
  }
  return out;
}

/** The pins a generated file declares, or `null` when it is not a manifest. */
function manifestPins(path: string, text: string): Pin[] | null {
  const base = path.slice(path.lastIndexOf("/") + 1);
  if (base === "package.json") return packageJsonPins(text);
  if (base.endsWith(".csproj") || base.endsWith(".fsproj")) return dotnetPins(text);
  if (base === "build.gradle.kts") return gradlePins(text);
  if (base === "pyproject.toml") return pyprojectPins(text);
  if (base === "mix.exs") return mixPins(text);
  if (base === "pubspec.yaml") return pubspecPins(text);
  return null;
}

/** Python pins carry the `==` operator stripped by the extractor; an extras
 *  suffix (`uvicorn[standard]`) is part of the name, not the version. */
function isExact(spec: string): boolean {
  return EXACT.test(spec);
}

function rangeViolations(files: ReadonlyMap<string, string>): string[] {
  const out: string[] = [];
  for (const [path, text] of files) {
    const pins = manifestPins(path, text);
    if (!pins) continue;
    for (const p of pins) {
      if (!isExact(p.spec)) out.push(`${path}: ${p.name} = ${p.spec}`);
    }
  }
  return out;
}

interface Case {
  readonly label: string;
  readonly source: string;
}

const PACK_SYSTEM = (platform: string, design: string): string =>
  platform === "elixir"
    ? `
system PackPins {
  subdomain Sales { context Sales {
    aggregate Customer { name: string  derived display: string = name }
    repository Customers for Customer { }
  } }
  api SalesApi from Sales
  ui Admin with scaffold(subdomains: [Sales]) { }
  storage primary { type: postgres }
  resource salesState { for: Sales, kind: state, use: primary }
  deployable app { platform: elixir  design: ${design}  contexts: [Sales]  dataSources: [salesState]  serves: SalesApi  ui: Admin  port: 4000 }
}`
    : `
system PackPins {
  subdomain Sales { context Sales {
    aggregate Customer { name: string }
    repository Customers for Customer { }
  } }
  api SalesApi from Sales
  storage primary { type: postgres }
  resource salesState { for: Sales, kind: state, use: primary }
  ui WebApp {
    api Sales: SalesApi
    page Home { route: "/"  body: Heading { "Hi", level: 1 } }
  }
  deployable api { platform: node  contexts: [Sales]  dataSources: [salesState]  serves: SalesApi  port: 3000 }
  deployable web { platform: ${platform}  design: ${design}  targets: api  ui: WebApp { Sales: api }  port: 3001 }
}`;

const FORMAT_PLATFORM = {
  tsx: "react",
  svelte: "svelte",
  vue: "vue",
  angular: "angular",
  heex: "elixir",
} as const;

function cases(): Case[] {
  const out: Case[] = [];
  for (const ddd of trackedDddFiles()) {
    if (ddd === UNPARSEABLE_DDD) continue;
    const text = readFileSync(resolve(REPO_ROOT, ddd), "utf8");
    if (!text.includes("__PLATFORM__")) {
      out.push({ label: ddd, source: text });
      continue;
    }
    for (const b of BACKENDS)
      out.push({
        label: `${ddd} [${b}]`,
        source: text.replaceAll("__PLATFORM__", PLATFORM_CLAUSE[b]),
      });
  }
  for (const family of Object.keys(BUILTIN_PACK_LATEST)) {
    const format = packFormatForBuiltin(family);
    if (!format) continue;
    out.push({
      label: `design pack ${family}`,
      source: PACK_SYSTEM(FORMAT_PLATFORM[format], family),
    });
  }
  return out;
}

interface Sweep {
  readonly generated: number;
  readonly manifests: Map<string, number>; // manifest basename → count
  readonly violations: string[];
  readonly waived: Set<string>;
}

let SWEEP: Promise<Sweep> | undefined;

function sweep(): Promise<Sweep> {
  SWEEP ??= (async () => {
    let generated = 0;
    const manifests = new Map<string, number>();
    const violations: string[] = [];
    const waived = new Set<string>();
    for (const c of cases()) {
      let files: Map<string, string>;
      try {
        files = await generateSystemFiles(c.source);
      } catch {
        continue; // not generatable standalone — ddd-source-census.test.ts's business
      }
      if (files.size === 0) continue;
      generated++;
      for (const [path, text] of files) {
        const pins = manifestPins(path, text);
        if (!pins) continue;
        const base = path.slice(path.lastIndexOf("/") + 1);
        manifests.set(base, (manifests.get(base) ?? 0) + 1);
        for (const p of pins) {
          if (isExact(p.spec)) continue;
          const key = `${base}:${p.name}`;
          if (Object.hasOwn(WAIVERS, key)) waived.add(key);
          else if (Object.hasOwn(WAIVED_ELSEWHERE, key)) continue;
          else violations.push(`${c.label} → ${path}: ${p.name} = ${p.spec}`);
        }
      }
    }
    return { generated, manifests, violations, waived };
  })();
  return SWEEP;
}

describe("generated manifests pin every dependency to an exact version", () => {
  it("reaches a real corpus: every manifest kind is read", async () => {
    const { generated, manifests } = await sweep();
    expect(generated, "the corpus stopped generating — this census is vacuous").toBeGreaterThan(
      300,
    );
    for (const kind of [
      "package.json",
      "pubspec.yaml",
      "pyproject.toml",
      "mix.exs",
      "build.gradle.kts",
    ]) {
      expect(manifests.get(kind) ?? 0, `no ${kind} reached the sweep`).toBeGreaterThan(0);
    }
    expect(
      [...manifests.keys()].some((k) => k.endsWith(".csproj")),
      "no .csproj reached the sweep",
    ).toBe(true);
    expect(
      [...manifests.keys()].some((k) => k.endsWith(".fsproj")),
      "no .fsproj reached the sweep",
    ).toBe(true);
  }, 900_000);

  it("no range specifier in any manifest", async () => {
    const { violations } = await sweep();
    const unique = [...new Set(violations.map((v) => v.replace(/^.*? → /, "")))];
    expect(unique, `ranges in generated manifests:\n${violations.slice(0, 20).join("\n")}`).toEqual(
      [],
    );
  }, 900_000);

  it("waivers ratchet — each still names a real, still-ranged dependency", async () => {
    const { waived } = await sweep();
    const stale = Object.keys(WAIVERS).filter((k) => !waived.has(k));
    expect(stale, `stale waivers (now exact or gone): ${stale.join(", ")}`).toEqual([]);
  }, 900_000);

  it("the detector can fail", () => {
    const bad = new Map([
      ["api/package.json", JSON.stringify({ dependencies: { hono: "^4.12.0" } })],
      ["api/Api.csproj", '<PackageReference Include="X" Version="1.*" />'],
      ["api/build.gradle.kts", 'implementation("a:b:[1.0,2.0)")'],
      ["api/pyproject.toml", 'dependencies = [\n  "fastapi>=0.115,<1",\n]\n'],
      ["api/mix.exs", '{:postgrex, ">= 0.0.0"}'],
      ["web/pubspec.yaml", "dependencies:\n  http: ^1.2.0\n"],
    ]);
    expect(rangeViolations(bad)).toHaveLength(6);
    const ok = new Map([
      ["api/package.json", JSON.stringify({ dependencies: { hono: "4.13.14" } })],
      ["api/Api.csproj", '<PackageReference Include="X" Version="1.2.3" />'],
      ["api/build.gradle.kts", 'implementation("a:b:1.0.0")'],
      ["api/pyproject.toml", 'dependencies = [\n  "uvicorn[standard]==0.54.0",\n]\n'],
      ["api/mix.exs", '{:postgrex, "0.22.4"}'],
      ["web/pubspec.yaml", "dependencies:\n  http: 1.6.0\n"],
    ]);
    expect(rangeViolations(ok)).toEqual([]);
  });
});

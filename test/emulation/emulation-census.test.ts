import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The emulated services exist ONCE.  Their semantics live in `src/emulation/`
// and every host — the browser playground's infra worker
// (`web/src/runtime/infra/`) and the Node test kit (`test/support/fakes/`) —
// wraps them in a transport and nothing else.  Two copies of a fake drift the
// way two copies of any rule do: the playground and the e2e tier would then
// pass against two different services, and neither would say so.
//
// Three rules:
//   1. `src/emulation/` is pure: it runs in a browser worker and in Node alike,
//      so it imports only its own modules — no `node:` module, no package, no
//      `web/` or other `src/` code — and reads no host global.
//   2. every host adapter imports the core model it wraps;
//   3. no host file carries a model's state or wire semantics: no module-level
//      mutable state beyond the one core instance, and none of the protocol
//      markers the models own.
// ---------------------------------------------------------------------------

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CORE = path.join(REPO, "src/emulation");
const WEB = path.join(REPO, "web/src/runtime/infra");
const NODE_KIT = path.join(REPO, "test/support/fakes");

const read = (p: string): string => fs.readFileSync(p, "utf8");
const files = (dir: string, ext: RegExp): string[] =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => ext.test(f))
        .map((f) => path.join(dir, f))
    : [];
/** Source with comments removed, so prose never trips a rule. */
const code = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/** Every host adapter, and the core module(s) it must import. */
const ADAPTERS: Record<string, string[]> = {
  "web/src/runtime/infra/mailbox.ts": ["mailbox"],
  "web/src/runtime/infra/disk.ts": ["disk"],
  "web/src/runtime/infra/http-mock.ts": ["http-mock"],
  "web/src/runtime/infra/aws-fake.ts": ["aws"],
  "web/src/runtime/infra/oidc.ts": ["oidc"],
  "web/src/runtime/infra/broker.service.ts": ["broker-model"],
  "web/src/runtime/infra/cache.ts": ["cache"],
  "web/src/runtime/infra/persist.ts": ["blob-store"],
};

/** Host files that are transport or wiring and own no model. */
const WIRING = new Set([
  "web/src/runtime/infra/router.ts",
  "web/src/runtime/infra/service.ts",
  "web/src/runtime/infra/services.ts",
  "web/src/runtime/infra/resource-types.ts",
]);

/** Strings only a model's wire semantics spell — an S3 listing, the OIDC token
 *  endpoint's grants, SES's action, the broker's dead-letter plumbing. */
const SEMANTIC_MARKERS = [
  "ListBucketResult",
  "NoSuchKey",
  "aws-chunked",
  "SendEmail",
  "grant_type",
  "code_verifier",
  "openid-configuration",
  "RSASSA-PKCS1-v1_5",
  "loom.dlx",
  'openapi-sampler").sample(',
];

const rel = (p: string): string => path.relative(REPO, p);

describe("emulation census", () => {
  it("src/emulation is pure — imports only itself, reads no host global", () => {
    const sources = files(CORE, /\.ts$/);
    expect(sources.length).toBeGreaterThan(5);
    const bad: string[] = [];
    for (const f of sources) {
      const c = code(read(f));
      if (/from\s+["']node:|import\(\s*["']node:|\brequire\(/.test(c))
        bad.push(`${rel(f)}: imports a Node module`);
      for (const m of c.matchAll(/(?:\bfrom\s+|\bimport\s*\(?\s*)["']([^"']+)["']/g)) {
        const spec = m[1] as string;
        if (spec.startsWith("../")) bad.push(`${rel(f)}: imports outside src/emulation (${spec})`);
        else if (!spec.startsWith("./") && !spec.startsWith("node:"))
          bad.push(`${rel(f)}: imports a package (${spec})`);
      }
      for (const g of [
        "process",
        "window",
        "document",
        "navigator",
        "self",
        "Buffer",
        "globalThis",
      ]) {
        if (new RegExp(`(^|[^.\\w$])${g}\\s*[.[]`).test(c))
          bad.push(`${rel(f)}: reads the host global \`${g}\``);
      }
      if (/\bpostMessage\b|\bMessagePort\b|\bWorker\b/.test(c))
        bad.push(`${rel(f)}: touches worker transport`);
    }
    expect(bad).toEqual([]);
  });

  it("every web/src/runtime/infra file is a known adapter or wiring", () => {
    const unknown = files(WEB, /\.ts$/)
      .map(rel)
      .filter((f) => !(f in ADAPTERS) && !WIRING.has(f));
    expect(
      unknown,
      "a new infra file must be listed here as an adapter (with its core) or as wiring",
    ).toEqual([]);
  });

  it("every host adapter imports the core model it wraps", () => {
    const missing: string[] = [];
    for (const [file, cores] of Object.entries(ADAPTERS)) {
      const c = code(read(path.join(REPO, file)));
      for (const m of cores) {
        if (!new RegExp(`["'][./]*(?:src|out)/emulation/${m}\\.(?:js|ts)["']`).test(c))
          missing.push(`${file} → ${m}`);
      }
    }
    for (const f of nodeKitAdapters()) {
      if (!/emulation/.test(code(read(f)))) missing.push(`${rel(f)} → src/emulation`);
    }
    expect(missing).toEqual([]);
  });

  it("no host file re-implements a model's state or wire semantics", () => {
    const bad: string[] = [];
    const hostFiles = [...files(WEB, /\.ts$/), ...files(NODE_KIT, /\.(m?js|ts)$/)];
    for (const f of hostFiles) {
      const c = code(read(f));
      for (const m of SEMANTIC_MARKERS) if (c.includes(m)) bad.push(`${rel(f)}: spells "${m}"`);
    }
    // Module-level mutable state in a web adapter: anything beyond the core
    // instance (`const x = createX(…)`) and frozen tables is a second model.
    for (const f of Object.keys(ADAPTERS).map((a) => path.join(REPO, a))) {
      for (const line of code(read(f)).split("\n")) {
        if (/^(export\s+)?let\s/.test(line))
          bad.push(`${rel(f)}: module-level \`let\`: ${line.trim()}`);
        if (/^(export\s+)?const\s+\w+\s*(:[^=]+)?=\s*(new\s+(Map|Set|Array)\b|\[)/.test(line)) {
          bad.push(`${rel(f)}: module-level collection: ${line.trim()}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

/** The Node kit's service adapters: every fake module except the kit's own
 *  plumbing.  Empty until the kit lands. */
function nodeKitAdapters(): string[] {
  const plumbing = new Set([
    "index.mjs",
    "sidecars.mjs",
    "quiesce.mjs",
    "resource-env.mjs",
    "emulation.mjs",
  ]);
  return files(NODE_KIT, /\.mjs$/).filter((f) => !plumbing.has(path.basename(f)));
}

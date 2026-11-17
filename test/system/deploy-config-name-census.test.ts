// Gate for D-NO-TOOL-NAME (docs/decisions).
//
// The deployment-configuration names a generated stack carries are derived
// from the system's own name and spelled once:
//
//  - the RabbitMQ definitions mount (`RABBIT_DEFINITIONS_MOUNT`,
//    `src/generator/_channels/auth.ts`), which compose and the Kubernetes
//    manifests both mount at the same paths;
//  - npm package names (`projectPackageName` / `e2ePackageName`,
//    `src/util/system-namespace.ts`): `<system>-<deployable>`,
//    `<system>-<deployable>-e2e`, `<system>-e2e`;
//  - the Helm chart's named templates, prefixed with the chart name
//    (`helmNames`, `src/system/helm.ts`).
//
// A second spelling (a hard-coded `/etc/rabbitmq/` path, a literal package
// name in a design pack, a Helm `include` of a fixed template name) is how a
// tool name or a stale name comes back.  A TypeScript comment line is prose
// and is skipped.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { expectReach } from "../_helpers/census-reach.js";
import { REPO_ROOT } from "../_helpers/ddd-corpus.js";

function files(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...files(p, ext));
    else if (e.name.endsWith(ext)) out.push(p);
  }
  return out;
}

const rel = (abs: string) => relative(REPO_ROOT, abs).replaceAll("\\", "/");
const isComment = (line: string) => /^\s*(\/\/|\*|\/\*)/.test(line);

/** `file:line  text` for every non-comment line of `src/` matching `re`,
 *  outside `except`. */
function sites(re: RegExp, except: string): string[] {
  const out: string[] = [];
  for (const abs of files(join(REPO_ROOT, "src"), ".ts")) {
    const file = rel(abs);
    if (file === except || file.startsWith("src/language/generated/")) continue;
    readFileSync(abs, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (!isComment(line) && re.test(line)) out.push(`${file}:${i + 1}  ${line.trim()}`);
      });
  }
  return out;
}

describe("deployment configuration names are spelled once", () => {
  it("the RabbitMQ definitions paths are spelled only in RABBIT_DEFINITIONS_MOUNT", () => {
    expect(
      sites(/\/etc\/rabbitmq\//, "src/generator/_channels/auth.ts"),
      "read the path from RABBIT_DEFINITIONS_MOUNT (src/generator/_channels/auth.ts)",
    ).toEqual([]);
  });

  it("every design pack names its package through {{packageName}}", () => {
    const packs = files(join(REPO_ROOT, "designs"), "package-json.hbs");
    expectReach("design-pack package-json templates", packs.length, 10);
    const literal = packs
      .map((abs) => [rel(abs), readFileSync(abs, "utf8")] as const)
      .filter(([, text]) => /"name":\s*"(?!\{\{packageName\}\}")/.test(text))
      .map(([file]) => file);
    expect(literal, "spell the package name as {{packageName}} (projectPackageName)").toEqual([]);
  });

  it("every Playwright manifest is named through e2ePackageName", () => {
    const calls = sites(/e2ePackageJson\(/, "src/generator/_frontend/e2e-harness.ts");
    expectReach("e2ePackageJson call sites", calls.length, 6);
    expect(calls.filter((c) => !/e2ePackageJson\(e2ePackageName\(/.test(c))).toEqual([]);
  });

  it("the Helm chart includes no fixed named template", () => {
    const helm = readFileSync(join(REPO_ROOT, "src/system/helm.ts"), "utf8")
      .split("\n")
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => !isComment(line) && /(include|define) "[a-z]/.test(line))
      .map(([n, line]) => `src/system/helm.ts:${n}  ${line.trim()}`);
    expect(helm, "name the template through helmNames(sys) (the chart's own name)").toEqual([]);
  });
});

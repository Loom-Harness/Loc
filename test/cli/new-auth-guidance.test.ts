// `ddd new`'s auth guidance after M-T3.1 (the `enforcement:` default flip).
//
// The starter used to carry a commented-out `enforcement: denyByDefault` block
// — the recommended posture, opted into by hand.  It is the default now, so
// the starter drops it and the README carries the paste-able `auth` block plus
// the `enforcement: opt` escape.  Both README snippets are asserted to MEAN
// what the README says when pasted into the real crud starter with
// `auth: required`: the plain block is deny-by-default (the starter's ungated
// `with crudish` members and its undeclared list + by-id reads are reported),
// the `enforcement: opt` block is not.

import { describe, expect, it } from "vitest";
import { renderReadme, renderStarter } from "../../src/cli/new-templates.js";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

const opts = { name: "myApp", platform: "node", design: "mantine" } as const;
const readme = renderReadme(opts);
const starter = renderStarter({ ...opts, template: "crud" });

/** The ```ddd fences of the README, in order. */
const fences = [...readme.matchAll(/```ddd\n([\s\S]*?)```/g)].map((m) => m[1] ?? "");

/** The crud starter with `blocks` pasted at the top of `system { … }` and the
 *  backend deployable marked `auth: required`, as the README instructs. */
function withAuth(blocks: string): string {
  const out = starter
    .replace(/(system \w+ \{\n)/, `$1${blocks}\n`)
    .replace(/(deployable api \{\n[^}]*?port: \d+)/, "$1,\n    auth: required");
  expect(out).toMatch(/port: \d+,\n {4}auth: required\n/);
  return out;
}

async function denyCodes(source: string): Promise<string[]> {
  const { model, doc } = await parseString(source, { validate: false });
  expect(doc.parseResult.parserErrors.map((e) => e.message)).toEqual([]);
  const loom = enrichLoomModel(lowerModel(model));
  // Vacuity guard: the splice really produced an auth-required backend.
  expect(loom.systems[0]?.deployables.find((d) => d.name === "api")?.auth?.required).toBe(true);
  return validateLoomModel(loom)
    .filter((d) => d.severity === "error")
    .map((d) => d.code ?? "");
}

describe("ddd new — auth guidance under the denyByDefault language default", () => {
  it("the starter no longer carries an `enforcement: denyByDefault` block", () => {
    expect(starter).not.toContain("enforcement: denyByDefault");
    expect(starter).toContain("README.md");
  });

  it("the README carries the auth block and an `enforcement: opt` example", () => {
    expect(fences).toHaveLength(2);
    expect(fences[0]).toContain("auth {");
    expect(fences[0]).not.toContain("enforcement");
    expect(fences[1]).toContain("enforcement: opt");
  });

  it("the README's plain auth block is deny-by-default in the real starter", async () => {
    const codes = await denyCodes(withAuth(fences[0] ?? ""));
    expect(codes.length).toBeGreaterThan(0);
    expect(new Set(codes)).toEqual(
      new Set(["loom.default-deny-ungated", "loom.default-deny-by-id-ungated"]),
    );
  });

  it("the README's `enforcement: opt` block validates clean in the real starter", async () => {
    const userBlock = (fences[0] ?? "").split("auth {")[0] ?? "";
    expect(await denyCodes(withAuth(`${userBlock}${fences[1] ?? ""}`))).toEqual([]);
  });
});

// Model-identity dedupe census (i18n, #4448).
//
// A model fact — an aggregate's plural name, a field's label, an operation's
// name — must reach the translator ONCE, under its context-qualified identity
// key (`Projects.Task.name.other`), however many pages, breadcrumbs, headings,
// nav entries, column headers and form labels show it.  Before identity keys
// the crud starter's catalog carried "Tasks" six times, each under a page +
// content-hash key, and a translator translated the same word six times (or,
// worse, five).
//
// The census runs the real crud starter (`ddd new --template crud`) through
// `generate system` and checks the catalog it writes:
//
//   1. no page-scoped (content-hash) key carries a message that IS the English
//      default of a model fact — such a key is a duplicate of that fact;
//   2. the React app's own `locales/en.json` carries the same identity keys;
//   3. the React pages and shell call `t()` with those keys at the implicit
//      sites (form labels, submit buttons, the sidebar).
//
// Mutation-proven: reverting one scaffold site to an English literal (the List
// heading, `pluralOf(aggName)` → `stringLit("Tasks")`) fails check 1.

import { beforeAll, describe, expect, it } from "vitest";
import { renderStarter } from "../../src/cli/new-templates.js";
import { isModelTextKey } from "../../src/util/model-text-key.js";
import { generateSystemFiles } from "../_helpers/index.js";

const STARTER = renderStarter({
  name: "x",
  template: "crud",
  platform: "node",
  design: "mantine",
  invocation: "ddd",
});

async function starterFiles(): Promise<Map<string, string>> {
  return await generateSystemFiles(STARTER);
}

function jsonAt(files: Map<string, string>, suffix: string): Record<string, string> {
  const hit = [...files].find(([p]) => p.endsWith(suffix));
  if (!hit) throw new Error(`no ${suffix} among ${[...files.keys()].length} files`);
  return JSON.parse(hit[1]) as Record<string, string>;
}

function fileAt(files: Map<string, string>, suffix: string): string {
  const hit = [...files].find(([p]) => p.endsWith(suffix));
  if (!hit) throw new Error(`no ${suffix}`);
  return hit[1];
}

describe("crud starter — one catalog key per model fact", () => {
  let files: Map<string, string>;
  let catalog: Record<string, string>;
  let identity: [string, string][];
  let identityTexts: Map<string, string>;
  beforeAll(async () => {
    files = await starterFiles();
    catalog = jsonAt(files, ".loom/messages.en.json");
    identity = Object.entries(catalog).filter(([k]) => isModelTextKey(k));
    identityTexts = new Map(identity.map(([k, v]) => [v, k]));
  });

  it("keys the model facts by identity", () => {
    expect(Object.fromEntries(identity)).toMatchObject({
      "Projects.Task.name.other": "Tasks",
      "Projects.Project.name.other": "Projects",
      "Projects.Task.field.title": "Title",
      "Projects.Task.op.create": "Create",
      "Projects.Task.op.update": "Update",
    });
  });

  it("carries no page-scoped duplicate of a model fact", () => {
    const duplicates = Object.entries(catalog)
      .filter(([k, v]) => !isModelTextKey(k) && identityTexts.has(v) && /\.page\./.test(k))
      .map(([k, v]) => `${k} = ${JSON.stringify(v)} duplicates ${identityTexts.get(v)}`);
    expect(duplicates).toEqual([]);
  });

  it("ships the same identity keys in the React app's catalog", () => {
    const app = jsonAt(files, "src/locales/en.json");
    for (const [k, v] of identity) expect(app[k], k).toBe(v);
  });

  it("calls t() with identity keys at the implicit sites", () => {
    const create = fileAt(files, "src/pages/tasks/new.tsx");
    expect(create).toContain('label={ t("Projects.Task.field.title", "Title") }');
    expect(create).toContain('{t("Projects.Task.op.create", "Create")}</Button>');
    const shell = fileAt(files, "src/App.tsx");
    expect(shell).toContain('label={t("Projects.Task.name.other", "Tasks")}');
  });
});

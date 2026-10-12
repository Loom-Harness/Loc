// The e2e operation call's optional third argument — `{ ifMatch: <version> }`,
// sent as the `If-Match` precondition header (M-T6.91, src/ir/util/e2e-call-options.ts).
//
// Before this, a third argument parsed, validated and was silently DROPPED by
// the renderer, so a test that meant to send a stale precondition sent none.
// The runtime half (the stale write really answers RS-39's 409 on every
// backend) is the `concurrency-conflict` corpus case; this file pins the
// compile-time contract: the accepted shape renders the header, every other
// shape is refused rather than dropped.
import { describe, expect, it } from "vitest";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { generateSystemFiles, toLoomModel } from "../_helpers/index.js";
import { parseString } from "../_helpers/parse.js";

const sys = (body: string): string => `
  system Pad {
    subdomain D {
      context C {
        aggregate Note with versioned, crudish {
          text: string
          operation retitle(text: string) { text := text }
        }
        repository Notes for Note { }
      }
    }
    api A from D
    storage pg { type: postgres }
    resource st { for: C, kind: state, use: pg }
    deployable d {
      platform: node
      contexts: [C]
      dataSources: [st]
      serves: A
      port: 4000
    }
    test e2e "t" against d {
      let n = api.notes.create({ text: "a" })
      ${body}
    }
  }
`;

async function codesFor(src: string): Promise<string[]> {
  const { model, errors } = await parseString(src);
  expect(errors).toEqual([]);
  return validateLoomModel(toLoomModel(model))
    .filter((d) => d.severity === "error")
    .map((d) => d.code ?? "<uncoded>");
}

describe("e2e call options — `{ ifMatch: v }`", () => {
  it("renders the update POST with the quoted If-Match entity-tag", async () => {
    const src = sys(`api.notes.update(n, { text: "b" }, { ifMatch: 1 })`);
    expect(await codesFor(src)).toEqual([]);
    const e2e = (await generateSystemFiles(src)).get("e2e/Pad.e2e.test.ts")!;
    expect(e2e).toContain(
      'await __postIfMatch(`${base}/api/notes/${n.id}/update`, ({ text: "b" }), 1)',
    );
    // The helper is emitted on demand, and sends the version as an entity-tag.
    expect(e2e).toContain('"if-match": `"${String(version)}"`');
  });

  it("a suite without the option carries no `__postIfMatch` helper", async () => {
    const e2e = (await generateSystemFiles(sys(`api.notes.update(n, { text: "b" })`))).get(
      "e2e/Pad.e2e.test.ts",
    )!;
    expect(e2e).not.toContain("__postIfMatch");
  });

  it("refuses an options object with any other key, rather than dropping it", async () => {
    expect(await codesFor(sys(`api.notes.update(n, { text: "b" }, { version: 1 })`))).toEqual([
      "loom.e2e-call-options",
    ]);
  });

  it("refuses a fourth argument", async () => {
    expect(
      await codesFor(sys(`api.notes.update(n, { text: "b" }, { ifMatch: 1 }, { ifMatch: 2 })`)),
    ).toEqual(["loom.e2e-call-options"]);
  });

  it("refuses `ifMatch` on an operation not every backend reads If-Match on", async () => {
    // elixir's named operations do not read the header — only `update` does on
    // all five, so a stale precondition there would pass on four and not one.
    expect(await codesFor(sys(`api.notes.retitle(n, { text: "b" }, { ifMatch: 1 })`))).toEqual([
      "loom.e2e-call-options",
    ]);
  });
});

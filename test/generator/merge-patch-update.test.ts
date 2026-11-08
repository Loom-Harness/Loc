// RS-47 — the generated `update` body is a JSON Merge Patch on every backend.
//
// Three facts each backend has to emit, pinned against its ENFORCEMENT surface
// (the request validator / handler the request actually hits), plus the shared
// predicate that decides which operation is a merge patch:
//
//   1. no key is required, and `null` stays legal only on a `T?` member;
//   2. an absent key passes the STORED value into the operation;
//   3. a wire rule runs only when the patch carries every member it reads.
//
// The behavioural proof is `test/fixtures/corpus/merge-patch-update.ddd` and
// its golden; this file is the fast, docker-free pin of each emission.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isMergePatchUpdate,
  mergePatchFields,
  ruleMembers,
} from "../../src/ir/util/merge-patch.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { buildLoomModel } from "../_helpers/ir.js";

const SYSTEM = (platform: string, extra = "") => `
system MergePatch {
  subdomain Work {
    context Desk {
      aggregate Memo with crudish {
        title: string
        note: string?
        pages: int
        minPages: int = 0
        invariant pages >= 0 message "Pages cannot be negative"
        invariant minPages <= pages message "A memo has at least its minimum pages"
        ${extra}
      }
      repository Memos for Memo { }
    }
  }
  api DeskApi from Work
  storage primary { type: postgres }
  resource deskState { for: Desk, kind: state, use: primary }
  deployable d {
    platform: ${platform}
    contexts: [Desk]
    dataSources: [deskState]
    serves: DeskApi
    port: 4000
  }
}
`;

async function filesFor(platform: string): Promise<Map<string, string>> {
  return generateSystemFiles(SYSTEM(platform));
}

function fileEndingWith(files: Map<string, string>, suffix: string): string {
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  expect(key, `no emitted file ending in ${suffix}`).toBeDefined();
  return files.get(key!)!;
}

async function memoAggregate(extra = "") {
  const model = await buildLoomModel(SYSTEM("node", extra));
  return model.systems[0]!.subdomains[0]!.contexts[0]!.aggregates[0]!;
}

describe("merge-patch update — the shared predicate", () => {
  it("recognises the crudish update and reports each member's nullability", async () => {
    const agg = await memoAggregate();
    const update = agg.operations.find((o) => o.name === "update")!;
    expect(mergePatchFields(update)?.map((f) => [f.name, f.nullable])).toEqual([
      ["title", false],
      ["note", true],
      ["pages", false],
      ["minPages", false],
    ]);
  });

  it("leaves every other operation a command", async () => {
    const agg = await memoAggregate(`
        operation rename(title: string) { title := title }
        operation bump(pages: int) { pages := pages + 1 }`);
    const byName = (n: string) => agg.operations.find((o) => o.name === n)!;
    // Same shape, other name: a command.
    expect(isMergePatchUpdate(byName("rename"))).toBe(false);
    expect(isMergePatchUpdate(byName("bump"))).toBe(false);
  });

  it("refuses an `update` whose body does more than assign its own parameters", async () => {
    const model = await buildLoomModel(
      SYSTEM("node").replace(
        "aggregate Memo with crudish {",
        "aggregate Memo {\n        operation update(pages: int) { pages := pages + 1 }",
      ),
    );
    const agg = model.systems[0]!.subdomains[0]!.contexts[0]!.aggregates[0]!;
    expect(isMergePatchUpdate(agg.operations.find((o) => o.name === "update")!)).toBe(false);
  });

  it("names the members a rule reads", async () => {
    const agg = await memoAggregate();
    const available = new Set(["title", "note", "pages", "minPages"]);
    expect(agg.invariants.map((inv) => ruleMembers(inv, available))).toEqual([
      ["pages"],
      ["minPages", "pages"],
    ]);
  });
});

describe("merge-patch update — node (Hono)", () => {
  it("makes every key optional and merges absent keys from the loaded aggregate", async () => {
    const routes = fileEndingWith(await filesFor("node"), "http/memo.routes.ts");
    const schema = routes.slice(routes.indexOf("const UpdateMemoRequest"));
    expect(schema).toMatch(/title: z\.string\(\)[^\n]*\.optional\(\),/);
    expect(schema).toMatch(/note: z\.string\(\)\.nullish\(\),/);
    expect(schema).toContain(
      "data.minPages === undefined || data.pages === undefined || (data.minPages <= data.pages)",
    );
    expect(routes).toContain("(body.title === undefined ? aggregate.title : body.title)");
    expect(routes).toContain(
      "(body.note === undefined ? aggregate.note : (body.note == null ? null : body.note))",
    );
  });

  it("answers a refused null with the missing-field sentence", async () => {
    const hook = fileEndingWith(await filesFor("node"), "http/problem-details.ts");
    expect(hook).toContain('issue.code === "invalid_type"');
    expect(hook).toContain("isMissing(result.data, issue)");
  });
});

describe("merge-patch update — .NET", () => {
  it("records the carried keys and merges in the handler", async () => {
    const files = await filesFor("dotnet");
    const req = fileEndingWith(files, "Requests/MemoRequests.cs");
    expect(req).toContain("public sealed class UpdateMemoRequest : IValidatableObject");
    expect(req).toContain('init { _title = value; _present.Add("title"); }');
    expect(req).not.toMatch(/UpdateMemoRequest\([^)]*JsonRequired/);
    expect(req).toContain(
      'if (_present.Contains("title") && _title is null) yield return new ValidationResult("The Title field is required."',
    );
    const handler = fileEndingWith(files, "Commands/UpdateHandler.cs");
    expect(handler).toContain(
      '(command.PatchedKeys.Contains("note") ? command.Note : aggregate.Note)',
    );
    const validator = fileEndingWith(files, "Commands/UpdateCommandValidator.cs");
    expect(validator).toContain(
      '!x.PatchedKeys.Contains("minPages") || !x.PatchedKeys.Contains("pages") || (x.MinPages <= x.Pages)',
    );
  });

  it("narrows a required value-object member's nested validator, which the patch may omit", async () => {
    // Every member of the update request is nullable, so `IValidator<CostRequest>`
    // must be bound to the narrowed `x.Cost!` (CS8620 under /warnaserror otherwise).
    const files = await generateSystemFiles(
      SYSTEM("dotnet", "cost: Cost").replace(
        "aggregate Memo",
        'valueobject Cost { amount: int  invariant amount >= 0 message "Cost cannot be negative" }\n      aggregate Memo',
      ),
    );
    const validators = fileEndingWith(files, "Requests/MemoRequestValidators.cs");
    const update = validators.slice(validators.indexOf("class UpdateMemoRequestValidator"));
    expect(update).toContain(
      "RuleFor(x => x.Cost!).SetValidator(new CostRequestValidator()).When(x => x.Cost is not null);",
    );
  });
});

describe("merge-patch update — python", () => {
  it("defaults every key to None and reads presence off model_fields_set", async () => {
    const routes = fileEndingWith(await filesFor("python"), "app/http/memo_routes.py");
    const model = routes.slice(routes.indexOf("class UpdateMemoRequest"));
    expect(model).toMatch(/ {4}title: WireStr \| None = None/);
    expect(model).toContain(
      'missing.append(InitErrorDetails(type="missing", loc=("title",), input=None))',
    );
    expect(model).toContain("if self.minPages is not None and self.pages is not None and not");
    expect(routes).toContain("(body.title if body.title is not None else found.title)");
    expect(routes).toContain('(body.note if "note" in body.model_fields_set else found.note)');
  });
});

describe("merge-patch update — java", () => {
  it("parses a money member at the validator with the field's own pointer", async () => {
    // The validator runs before the service, so its parse is the refusal the
    // client sees; a document-root pointer would name no field.
    const files = await generateSystemFiles(
      readFileSync("test/fixtures/corpus/wire-ingress.ddd", "utf8").replace("__PLATFORM__", "java"),
    );
    const validator = fileEndingWith(files, "UpdateProductValidator.java");
    expect(validator).toContain('WireFormatException.money(request.price(), "/price")');
  });

  it("imports the shared FileRef record for a File member", async () => {
    const files = await generateSystemFiles(
      readFileSync("test/fixtures/corpus/file-download.ddd", "utf8").replace(
        "__PLATFORM__",
        "java",
      ),
    );
    const req = fileEndingWith(files, "UpdateAttachmentRequest.java");
    expect(req).toContain("private FileRef doc;");
    expect(req).toMatch(/^import [\w.]+\.domain\.common\.FileRef;$/m);
  });

  it("records the carried keys and merges in the service", async () => {
    const files = await filesFor("java");
    const req = fileEndingWith(files, "UpdateMemoRequest.java");
    expect(req).toContain("public final class UpdateMemoRequest {");
    expect(req).not.toContain("@NotNull");
    expect(req).toContain('present.add("title");');
    const validator = fileEndingWith(files, "UpdateMemoValidator.java");
    expect(validator).toContain(
      'if (request.has("title") && title == null) errors.rejectValue("title", "NotNull"',
    );
    expect(validator).toContain('if (request.has("minPages") && request.has("pages")) {');
    const service = fileEndingWith(files, "MemoService.java");
    expect(service).toContain('request.has("note") ? note : aggregate.note()');
    const spec = fileEndingWith(files, "OpenApiContractCustomizer.java");
    expect(spec).toContain('new RequiredSet("UpdateMemoRequest", List.of())');
  });
});

describe("merge-patch update — elixir", () => {
  it("casts the patch over the row, refuses a required null, and re-stages each rule", async () => {
    const files = await filesFor("elixir");
    const changeset = fileEndingWith(files, "desk/memo_changeset.ex");
    const update = changeset.slice(changeset.indexOf("def update_changeset"));
    expect(update.slice(0, update.indexOf("\n  end"))).not.toMatch(/__require_keys|__clear_absent/);
    expect(update).toContain("|> validate_patch_invariants(attrs)");
    // Keyed by the rule's identity key (its wire code), never its text.
    expect(changeset).toMatch(/defp __patch_members\("[^"]+"\), do: \["min_pages", "pages"\]/);
    const controller = fileEndingWith(files, "controllers/memo_controller.ex");
    expect(controller).toContain("@patch_required ~w(title pages minPages)");
    expect(controller).not.toMatch(/@required_params %\{[^}]*update:/);
  });
});

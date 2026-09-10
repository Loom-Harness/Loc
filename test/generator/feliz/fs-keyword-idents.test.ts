// An aggregate whose name lowercases to an F# KEYWORD broke the whole Feliz
// build.  The wire decoder binding is `lowerFirst(<Aggregate>)`, so
// `aggregate Member` emitted
//
//     and member : Decoder<Member> =
//
// and `dotnet fable` stopped at "Unexpected keyword 'member' in binding (code
// 10)", cascading into three more syntax errors.  From a `.ddd` that validates
// `0 error(s), 0 warning(s)` — `Member` is an ordinary domain noun, not an edge
// case, and so are `Event`, `Type`, `Component`, `Process`, `Method`, `Object`.
//
// The .NET backend already GATES its own version of this collision
// (`loom.dotnet-name-collision`).  Feliz had neither a gate nor an escape,
// which is the worst of the three states: silent miscompile.  F# has
// first-class escaping — a ``double-backtick`` identifier is legal anywhere a
// plain one is — so this ESCAPES rather than refuses, and `aggregate Member`
// keeps working on Feliz as it does on the other five frontends.
import { describe, expect, it } from "vitest";
import { fsIdent, isFsKeyword } from "../../../src/generator/feliz/fs-ident.js";
import { generateSystemFiles } from "../../_helpers/index.js";

const system = (aggName: string) => `
  system P {
    subdomain S {
      context C {
        aggregate ${aggName} {
          label: string
          derived display: string = label
        }
        repository ${aggName}s for ${aggName} { }
      }
    }
    ui W with scaffold(subdomains: [S]) { }
    api PApi from S
    storage primary { type: postgres }
    resource s { for: C, kind: state, use: primary }
    deployable api {
      platform: node
      contexts: [C]
      dataSources: [s]
      serves: PApi
      port: 3000
    }
    deployable web {
      platform: feliz
      targets: api
      ui: W
      port: 3001
      design: "light"
    }
  }
`;

const appFs = async (aggName: string): Promise<string> => {
  const files = await generateSystemFiles(system(aggName));
  const src = [...files.entries()]
    .filter(([p]) => p.endsWith("App.fs"))
    .map(([, c]) => c)
    .join("\n");
  expect(src.length, "an App.fs was emitted").toBeGreaterThan(0);
  return src;
};

// The second site, found only by actually running `dotnet fable`: an OPERATION
// PARAMETER named `to` becomes a form-record FIELD, so the same class hit
// `type AssignIssueForm = { to: string }` → "Unexpected keyword 'to' in field
// declaration".  `wireName` serves three roles (F# field, JSON key, and the
// string keys of the touched-set / error ids), and only the F# one may carry
// the escape — hence the separate `fsName`.
const OP_SYSTEM = `
  system P {
    subdomain S {
      context C {
        aggregate Target {
          label: string
          derived display: string = label
        }
        aggregate Item {
          title: string
          owner: Target id?
          operation assign(to: Target id) {
            owner := to
          }
        }
        repository Targets for Target { }
        repository Items for Item { }
      }
    }
    ui W with scaffold(subdomains: [S]) { }
    api PApi from S
    storage primary { type: postgres }
    resource s { for: C, kind: state, use: primary }
    deployable api {
      platform: node
      contexts: [C]
      dataSources: [s]
      serves: PApi
      port: 3000
    }
    deployable web {
      platform: feliz
      targets: api
      ui: W
      port: 3001
      design: "light"
    }
  }
`;

describe("Feliz — a model name that lowercases to an F# keyword", () => {
  it("escapes the decoder binding so `dotnet fable` can parse it", async () => {
    const src = await appFs("Member");
    // The binding, and every reference to it, carry the escape.
    expect(src).toMatch(/``member`` : Decoder<Member> =/);
    // The exact bytes fable rejected: a BARE `member` introducing the binding.
    expect(src).not.toMatch(/(?:^|\n)\s*(?:let rec |let |and )member : Decoder<Member>/);
  });

  it("leaves a non-keyword name byte-identical", async () => {
    const src = await appFs("Widget");
    // `let` / `let rec` / `and` depends on how many records the group holds,
    // so match the binding NAME, not the keyword that introduces it.
    expect(src).toMatch(/\bwidget : Decoder<Widget> =/);
    expect(src).not.toContain("``");
  });

  it("knows the keywords that a plausible aggregate name collides with", () => {
    // Reserved words that are also ordinary domain nouns — the ones this is
    // actually protecting against.
    for (const k of ["member", "event", "type", "component", "process", "method", "object"]) {
      expect(isFsKeyword(k), `${k} is an F# keyword`).toBe(true);
      expect(fsIdent(k)).toBe(`\`\`${k}\`\``);
    }
    expect(isFsKeyword("widget")).toBe(false);
    expect(fsIdent("widget")).toBe("widget");
  });

  it("escapes a keyword-named operation parameter in every F# position", async () => {
    const files = await generateSystemFiles(OP_SYSTEM);
    const src = [...files.entries()]
      .filter(([p]) => p.endsWith("App.fs"))
      .map(([, c]) => c)
      .join("\n");
    // The form record field, its empty binding, and the accessor.
    expect(src).toMatch(/``to``: string/);
    expect(src).toMatch(/``to`` = ""/);
    expect(src).toMatch(/form\.``to``/);
    // The exact bytes fable rejected — a BARE `to` in field position.
    expect(src).not.toMatch(/^\s+to: string/m);
    expect(src).not.toMatch(/^\s+to = ""/m);
    // …but the JSON KEY must stay unescaped, or the request body renames the
    // field and the backend 422s on a parameter it never received.
    expect(src).toContain('"to", Encode.string form.``to``');
  });

  // The escape has to reach every QUALIFIED reference too, not just the binding.
  // `fsIdent` was first applied only to the binding site and to
  // `decoderExprFor`; six other call sites build `Decoders.<name>` themselves
  // (the paged-envelope item decoder, the optional decoder, the single-record
  // decoder, the row list/option pair, and the union-tag decoder).  With the
  // binding escaped and the references not, `dotnet fable` moved on to
  //     ./src/App.fs(590,131): error FSHARP: Missing qualification after '.'
  //     ./src/App.fs(590,132): error FSHARP: Unexpected keyword 'member' in expression
  // — the same defect one layer out.  Only running fable found it, which is why
  // this asserts the reference shape and not just the declaration.
  it("escapes every qualified `Decoders.<name>` reference, not just the binding", async () => {
    const src = await appFs("Member");
    // The paged list read is the reference site the scaffold always emits.
    expect(src).toMatch(/Decode\.list Decoders\.``member``/);
    // No bare qualified reference survives anywhere.
    expect(src).not.toMatch(/Decoders\.member\b/);
  });
});

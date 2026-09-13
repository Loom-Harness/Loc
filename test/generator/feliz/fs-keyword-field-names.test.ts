// F-022 (#2922) — a MODEL FIELD named after an F# keyword reached the generated
// F# verbatim, so `dotnet fable` refused the whole frontend:
//
//   App.fs(128,5): error FSHARP: Unexpected keyword 'member' in field declaration (code 10)
//   App.fs(128,5): error FSHARP: This field requires a name (code 882)
//   App.fs(158,7): error FSHARP: Unmatched '{' (code 604)
//
// `fs-keyword-idents.test.ts` already pins the two positions found earlier — the
// aggregate NAME (the decoder binding) and an OPERATION PARAMETER (the form
// record).  This pins the FIELD position and the five further sites it reaches:
// the wire record, its Thoth decoder, a field READ (view + update paths), the
// client-side sort comparator, a find PARAMETER binder, and a component's props
// record / bindings / call site.
//
// The escape is `fsIdent` (double backticks) — lexically the same identifier, so
// the JSON key, the query-string key and every `data-testid` stay UNescaped and
// the wire does not move.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const SYSTEM = `
  system P {
    subdomain S {
      context C {
        valueobject Span { begin: string  end: string }
        aggregate Circle with crudish {
          member: string
          val: string
          span: Span
          plain: string
        }
        repository Circles for Circle {
          find byMember(member: string): Circle[] where this.member == member
        }
      }
    }
    ui W with scaffold(subdomains: [S]) {
      store Prefs {
        state { member: string = "" }
        action setMember(val: string) { member := val }
      }
      component Row(member: string, plain: string) {
        derived base: string = member
        body: Stack { Text { member }, Text { plain }, Text { base } }
      }
      page Manual {
        route: "/manual"
        state { member: string = "" }
        derived struct: string = member
        action begin() { member := "x" }
        body: Stack {
          Text { struct },
          Button { "go", onClick: begin },
          Row { member: "a", plain: "b" }
        }
      }
    }
    storage primary { type: postgres }
    resource s { for: C, kind: state, use: primary }
    deployable api { platform: node  contexts: [C]  dataSources: [s]  port: 3000 }
    deployable web { platform: feliz  targets: api  ui: W  port: 3001 }
  }
`;

let cached: string | undefined;
async function appFs(): Promise<string> {
  if (cached === undefined) {
    const files = await generateSystemFiles(SYSTEM);
    cached = [...files.entries()]
      .filter(([p]) => p.endsWith("App.fs"))
      .map(([, c]) => c)
      .join("\n");
    expect(cached.length, "an App.fs was emitted").toBeGreaterThan(0);
  }
  return cached;
}

describe("F-022 — a field named after an F# keyword", () => {
  it("escapes the wire record's field declaration", async () => {
    const src = await appFs();
    expect(src).toMatch(/^\s+``member``: string$/m);
    expect(src).toMatch(/^\s+``val``: string$/m);
    // The exact bytes fable rejected — a BARE keyword in field position.
    expect(src).not.toMatch(/^\s+member: string$/m);
    expect(src).not.toMatch(/^\s+val: string$/m);
  });

  it("escapes a value object's field declarations too", async () => {
    const src = await appFs();
    expect(src).toMatch(/^\s+``begin``: string$/m);
    expect(src).toMatch(/^\s+``end``: string$/m);
  });

  it("escapes the decoder's record field but NOT the JSON key it reads", async () => {
    const src = await appFs();
    expect(src).toContain('``member`` = get.Required.Field "member" Decode.string');
    expect(src).not.toMatch(/^\s+member = get\.Required\.Field/m);
  });

  it("escapes a field READ in a page body", async () => {
    const src = await appFs();
    expect(src).toContain("row.``member``");
    // A bare `.member` read anywhere is the parse error.
    expect(src).not.toMatch(/\brow\.member\b/);
  });

  it("escapes both field reads in the client-side sort comparator", async () => {
    const src = await appFs();
    expect(src).toContain('| "member" -> compare a.``member`` b.``member``');
    expect(src).not.toContain('| "member" -> compare a.member b.member');
  });

  it("escapes a find PARAMETER binder but NOT the query-string key", async () => {
    const src = await appFs();
    expect(src).toMatch(/let circleByMember \(``member``: string\)/);
    expect(src).not.toMatch(/let circleByMember \(member: string\)/);
    // The key the backend reads stays the declared name.
    expect(src).toContain("?member=%s");
  });

  it("escapes a component's props field, its binding, and the call site", async () => {
    const src = await appFs();
    expect(src).toMatch(/let Row .*\{\| ``member``: string/);
    expect(src).toContain("let ``member`` = props.``member``");
    expect(src).toMatch(/``member`` = "a"/);
    // …and the param READ inside the component body.
    expect(src).toContain("string (``member``)");
    expect(src).not.toMatch(/\(string \(member\)\)/);
  });

  it("escapes a `derived` binding and its read, on both a page and a component", async () => {
    const src = await appFs();
    // Page: `derived struct: string = member` → the binding and the `Text` read.
    expect(src).toContain("let ``struct`` = ");
    expect(src).toContain("string (``struct``)");
    // Component: `derived base: string = member`.
    expect(src).toContain("let ``base`` = ");
    expect(src).not.toMatch(/^\s+let (?:struct|base) = /m);
  });

  it("escapes an `action` at BOTH its dispatch binding and its call site", async () => {
    const src = await appFs();
    // `renderNamedHandler` emits the binding; `actionHandlerName` the reference.
    expect(src).toMatch(/let ``begin`` \(\) = dispatch /);
    expect(src).toContain("``begin``()");
    expect(src).not.toMatch(/let begin \(\) = dispatch /);
    expect(src).not.toMatch(/-> begin\(\)/);
  });

  it("escapes a store action's Msg-arm parameter binding", async () => {
    const src = await appFs();
    // `action setMember(val: string)` → `| PrefsSetMember ``val`` ->`.
    expect(src).toMatch(/\| PrefsSetMember ``val`` ->/);
    expect(src).not.toMatch(/\| PrefsSetMember val ->/);
  });

  it("leaves a non-keyword field byte-identical", async () => {
    const src = await appFs();
    expect(src).toMatch(/^\s+plain: string$/m);
    expect(src).toContain('plain = get.Required.Field "plain" Decode.string');
    expect(src).not.toContain("``plain``");
  });

  // The class-level gate: rather than enumerate the sites, scan the whole
  // emitted App.fs for ANY bare F# keyword in identifier position.  The keyword
  // list is restricted to words the Feliz emitter never writes itself, so a hit
  // is always a model identifier that escaped un-escaped.
  it("emits no bare F# keyword anywhere in App.fs", async () => {
    const src = await appFs();
    const KW = ["member", "val", "begin", "end", "base", "inherit", "struct", "lazy"];
    const re = new RegExp(`(?<![\\w'])(?:${KW.join("|")})(?![\\w'!])`, "g");
    const hits = src
      .split("\n")
      // Strip escaped identifiers, string literals, and comments — a keyword
      // inside any of those is not an identifier.
      .map((l) => l.replace(/``[^`]+``/g, "«esc»").replace(/"(?:[^"\\]|\\.)*"/g, '""'))
      .filter((l) => !/^\s*(\/\/|\(\*)/.test(l))
      .filter((l) => re.test(l))
      .map((l) => l.trim().slice(0, 120));
    expect(hits).toEqual([]);
  });
});

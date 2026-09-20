// Feliz frontend — the `persist: local|session|url` store lifetime ladder
// (M-T1.20, frontend-state-management.md §3.1).
//
// A Feliz store has no module of its own: it FOLDS into the single Elmish
// `Model`.  Persistence therefore rides the fold — `init` seeds each persisted
// field from its backing store, an `updateWithPersist` wrapper mirrors the
// Model back after every message, and the `url` tier additionally re-decodes on
// `popstate` through a real Elmish subscription.
//
// The keys and shapes match the four JS store builders byte-for-byte
// (`loom.store.<Name>` + a JSON object keyed by the bare field name; one query
// param per bare field name, empties dropped), so the same blob and the same
// URL round-trip across frontends.  That agreement is what the assertions below
// pin — a change to either side has to change both.
//
// The emitted F# is proven to `dotnet fable`-compile by
// `generated-feliz-build.yml`, whose showcase now carries all four lifetimes.

import { describe, expect, it } from "vitest";
import { generateFelizForContexts } from "../../../src/generator/feliz/index.js";
import { buildLoomModel } from "../../_helpers/ir.js";

const sys = (uiBody: string) => `
system P {
  subdomain S { context C { enum Status { open closed } } }
  ui WebApp {
${uiBody}
    page Home {
      route: "/"
      body: Stack { Heading { "Home", level: 1 } }
    }
  }
  deployable api { platform: node contexts: [C] port: 3000 }
  deployable web { platform: feliz targets: api ui: WebApp port: 3005 }
}`;

async function app(uiBody: string): Promise<string> {
  const model = await buildLoomModel(sys(uiBody));
  const system = model.systems[0]!;
  const web = system.deployables.find((d) => d.name === "web")!;
  return generateFelizForContexts([], system, web).get("src/App.fs")!;
}

const LOCAL_STORE = `
    store Draft persist: local {
      state {
        note:  string = "hi"
        seen:  int = 0
        ok:    bool
        price: money
        tags:  string[]
      }
      action write(t: string) { note := t }
    }`;

const SESSION_STORE = `
    store Prefs persist: session {
      state { mode: string = "dark" }
      action setMode(m: string) { mode := m }
    }`;

const URL_STORE = `
    store Filters persist: url {
      state { term: string = ""  pageNo: int = 0  onlyOpen: bool }
      action setTerm(q: string) { term := q }
    }`;

const MEMORY_STORE = `
    store Cart {
      state { items: int = 0 }
      action add() { items := items + 1 }
    }`;

describe("feliz `persist: local|session` — Web Storage hydration", () => {
  it("seeds every persisted field in `init` from a loader, not from the declared default", async () => {
    const fs = await app(LOCAL_STORE);
    expect(fs).toContain("DraftNote = StorePersist.loadDraftNote ()");
    expect(fs).toContain("DraftSeen = StorePersist.loadDraftSeen ()");
    expect(fs).toContain("DraftPrice = StorePersist.loadDraftPrice ()");
    // The declared `= "hi"` moves INTO the loader as the miss fallback.
    expect(fs).not.toContain('DraftNote = "hi"');
  });

  it("reads the SAME key + JSON field the JS store builders write", async () => {
    const fs = await app(LOCAL_STORE);
    expect(fs).toContain('webField "local" "loom.store.Draft" "note"');
    expect(fs).toContain('webWrite "local" "loom.store.Draft" json');
  });

  it("falls back to the field's declared init, or the type zero, on a miss", async () => {
    const fs = await app(LOCAL_STORE);
    expect(fs).toContain('if isNull raw then "hi" else raw');
    expect(fs).toContain("if isNull raw then 0 else (match System.Int32.TryParse raw");
    expect(fs).toContain('if isNull raw then false else raw = "true"');
    expect(fs).toContain("if isNull raw then 0m else (match System.Decimal.TryParse raw");
  });

  it("writes the blob back with the JS frontends' value shapes", async () => {
    const fs = await app(LOCAL_STORE);
    // string → JSON string; int → JSON number; bool → literal; money → JSON
    // STRING (the JS side holds a `Decimal`, whose `toJSON` is a string).
    expect(fs).toContain('"\\"note\\":" + jsonString model.DraftNote');
    expect(fs).toContain('"\\"seen\\":" + string model.DraftSeen');
    expect(fs).toContain('"\\"ok\\":" + (if model.DraftOk then "true" else "false")');
    expect(fs).toContain('"\\"price\\":" + jsonString (string model.DraftPrice)');
  });

  it("round-trips a scalar array through the array reader", async () => {
    const fs = await app(LOCAL_STORE);
    expect(fs).toContain('webFieldArray "local" "loom.store.Draft" "tags"');
    expect(fs).toContain("if isNull cells then [] else List.ofArray cells");
    expect(fs).toContain("model.DraftTags |> List.map (fun x -> jsonString x)");
  });

  it("`session` uses sessionStorage under the same key", async () => {
    const fs = await app(SESSION_STORE);
    expect(fs).toContain('webField "session" "loom.store.Prefs" "mode"');
    expect(fs).toContain('webWrite "session" "loom.store.Prefs" json');
  });

  it("mirrors the Model back through an `updateWithPersist` wrapper Program runs", async () => {
    const fs = await app(LOCAL_STORE);
    expect(fs).toContain("let updateWithPersist (msg: Msg) (model: Model) =");
    expect(fs).toContain("StorePersist.save next");
    expect(fs).toContain("Program.mkProgram init updateWithPersist safeView");
  });
});

describe("feliz `persist: url` — the query string is the source of truth", () => {
  it("seeds from the query param of the same bare field name", async () => {
    const fs = await app(URL_STORE);
    expect(fs).toContain('urlParam "term"');
    expect(fs).toContain('urlParam "pageNo"');
    expect(fs).toContain("FiltersTerm = StorePersist.loadFiltersTerm ()");
  });

  it("encodes exactly like `encodeFieldToParam`: empty string dropped, number always, bool only when true", async () => {
    const fs = await app(URL_STORE);
    // Parenthesised `$0`: Fable's Emit scanner swallows a `!` that directly
    // follows a placeholder, so `$0!==''` compiled to `==''`.
    expect(fs).toContain("if(($0)!==''){p.set('term',$0);}else{p.delete('term');}");
    expect(fs).toContain("p.set('pageNo',String($1));");
    expect(fs).toContain("if($2){p.set('onlyOpen','true');}else{p.delete('onlyOpen');}");
    expect(fs).toContain("window.history.replaceState(null,''");
  });

  it("re-decodes on back/forward through a real Elmish subscription", async () => {
    const fs = await app(URL_STORE);
    expect(fs).toContain("| StoreUrlChanged");
    expect(fs).toContain("| StoreUrlChanged -> { model with FiltersTerm = StorePersist.");
    expect(fs).toContain("window.addEventListener('popstate', $0)");
    expect(fs).toContain("window.removeEventListener('popstate', $0)");
    expect(fs).toContain("|> Program.withSubscription storeUrlSub");
  });
});

// Wave C2 packet 2i — the four cell types the F# codec table used to refuse
// (`store-lifetime-target-unsupported#field`).  Each now has a TOTAL F#
// conversion, and each writes back the SAME string/number the JS store
// builders hold, so the shared `loom.store.<Name>` blob still round-trips.
describe("feliz `persist:` — datetime / guid / enum / decimal arrays", () => {
  const WIDE_STORE = `
    store Wide persist: local {
      state {
        at:     datetime
        ref:    guid
        mode:   Status
        rates:  decimal[]
        prices: money[]
        stamps: datetime[]
      }
      action setMode(m: Status) { mode := m }
    }`;

  it("loads a datetime through a TOTAL TryParse, defaulting to the type zero", async () => {
    const fs = await app(WIDE_STORE);
    expect(fs).toContain(
      "if isNull raw then System.DateTime.MinValue else (match System.DateTime.TryParse raw",
    );
  });

  // A guid does NOT get a TryParse: on this frontend a Loom `guid` IS an F#
  // `string` (`type-fs.ts` has no `guid` arm, `decoderExprFor` decodes one with
  // `Decode.string`, the query encoder passes it verbatim).  `System.Guid.TryParse`
  // bound a `System.Guid` into a `string`-typed cell — `FS0001`, the mirror image
  // of the mismatch the missing `fsPrimitive` arm exists to prevent.  The written
  // form is already the canonical guid string, so the identity load round-trips it.
  it("loads a guid as the string it is, with no Guid parse", async () => {
    const fs = await app(WIDE_STORE);
    expect(fs).not.toContain("System.Guid");
  });

  it("writes datetime back as ISO-8601 and a guid as its canonical string", async () => {
    const fs = await app(WIDE_STORE);
    expect(fs).toContain('"\\"at\\":" + jsonString (model.WideAt.ToString("o"))');
    expect(fs).toContain('"\\"ref\\":" + jsonString (string model.WideRef)');
  });

  it("carries an enum cell as a plain `string`, the F# spelling of every enum", async () => {
    const fs = await app(WIDE_STORE);
    expect(fs).toContain("WideMode: string");
    expect(fs).toContain('"\\"mode\\":" + jsonString model.WideMode');
    expect(fs).toContain('if isNull raw then "" else raw');
  });

  it("lists decimal / money / datetime elements with the JS side's value shapes", async () => {
    const fs = await app(WIDE_STORE);
    // decimal[] → JSON numbers (the JS side holds `number[]`); money[] → JSON
    // strings (a `Decimal`'s `toJSON`); datetime[] → ISO strings.
    expect(fs).toContain("model.WideRates |> List.map (fun x -> string x)");
    expect(fs).toContain("model.WidePrices |> List.map (fun x -> jsonString (string x))");
    expect(fs).toContain('model.WideStamps |> List.map (fun x -> jsonString (x.ToString("o")))');
    expect(fs).toContain(
      "cells |> Array.map (fun raw -> match System.Decimal.TryParse raw with | true, v -> v | _ -> 0m)",
    );
  });

  it("stringifies datetime / guid in F# BEFORE the url writer's JS boundary", async () => {
    // A Fable `System.DateTime` reaches JS as a `Date`, whose `String(…)` is
    // the locale form — so `String($0)` inside the `[<Emit>]` would write a
    // param neither side can decode.  The conversion belongs in F#.
    const fs = await app(`
    store Range persist: url {
      state { since: datetime  who: guid }
    }`);
    expect(fs).toContain(
      'let private saveRange (model: Model) : unit = saveRangeRaw (model.RangeSince.ToString("o")) (string model.RangeWho)',
    );
    expect(fs).toContain("(sinceArg: string) (whoArg: string)");
    expect(fs).toContain("p.set('since',$0);p.set('who',$1);");
  });
});

describe("feliz `persist:` — what it must NOT touch", () => {
  it("NEGATIVE CONTROL: a `memory` store emits no persistence at all", async () => {
    const fs = await app(MEMORY_STORE);
    expect(fs).not.toContain("StorePersist");
    expect(fs).not.toContain("updateWithPersist");
    expect(fs).not.toContain("localStorage");
    expect(fs).not.toContain("StoreUrlChanged");
    // The memory store still folds into the Model + init exactly as before.
    expect(fs).toContain("CartItems: int");
    expect(fs).toContain("CartItems = 0");
    expect(fs).toContain("Program.mkProgram init update safeView");
  });

  it("a memory store ALONGSIDE persisted ones keeps its declared init", async () => {
    const fs = await app(`${LOCAL_STORE}\n${MEMORY_STORE}`);
    expect(fs).toContain("CartItems = 0");
    expect(fs).not.toContain("CartItems = StorePersist.");
    expect(fs).not.toContain("saveCart");
  });

  it("a url store and a Web Storage store coexist — one `save`, one Msg", async () => {
    const fs = await app(`${LOCAL_STORE}\n${URL_STORE}`);
    expect(fs).toContain("saveDraft model");
    expect(fs).toContain("saveFilters model");
    expect((fs.match(/\| StoreUrlChanged\b/g) ?? []).length).toBe(2); // Msg case + update arm
  });
});

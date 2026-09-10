// ---------------------------------------------------------------------------
// `loom.destroy-form-of-unresolved` — the `DestroyForm` twin of
// `loom.op-form-needs-route-id` (audit findings F11 / F62, mission M-T1.31).
//
// `DestroyForm { of: <X> }` where `X` is not an aggregate carrying a canonical
// destroy reported `0 error(s), 0 warning(s)` on `main`, and then:
//
//   FIVE FRONTENDS DEGRADE.  react / vue / svelte / angular / flutter each hit
//   one of the three give-up branches in
//   `src/generator/_walker/primitives/forms.ts` and emit a comment
//   (`{/* loom:unrendered DestroyForm(of: Gadget): aggregate not found */}`) —
//   measured on `main`.  The page silently loses its delete button.
//
//   FELIZ MISCOMPILES.  `renderDestroyForm` (`feliz/feliz-target.ts`) never
//   consults `ctx.aggregatesByName`; it interpolates the raw ref NAME into a
//   `Delete<Name>` dispatch.  The `Msg` case, though, is collected by
//   `formOfAggs` (`feliz/wire.ts`), which DOES filter by that map.  Measured on
//   `main` for `DestroyForm { of: Gadget }` (a value object) — `App.fs` carried
//
//       type Msg = | UrlChanged of string list
//       …
//       prop.onClick (fun _ -> dispatch (DeleteGadget id))
//
//   i.e. a dispatch of a union case that does not exist → `dotnet fable`
//   FS0039, from a `.ddd` the toolchain reported as clean.
//
// The fix is a PHASE-⑦ check, not an emitter diagnostic: a generator runs at
// phase ⑧ and cannot raise a `loom.*` code.  The give-up branches stay as the
// belt to this brace.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

const CODE = "loom.destroy-form-of-unresolved";

/** `Item` — `with crudish`, so it HAS a canonical destroy (negative control 1).
 *  `Ledger` — an explicit `destroy { }` (negative control 2).
 *  `Note` — neither, so `DestroyForm { of: Note }` has nothing to submit.
 *  `Gadget` — a value object: a resolvable NAME that is not an aggregate. */
const wrap = (members: string) => `
system Demo {
  subdomain S {
    context Shop {
      valueobject Gadget { label: string }
      aggregate Item with crudish { name: string }
      aggregate Note { text: string }
      aggregate Ledger {
        title: string
        create(title: string) { }
        destroy { }
      }
      repository Items for Item { }
      repository Notes for Note { }
      repository Ledgers for Ledger { }
    }
  }
  api ShopApi from S
  ui Web {
    framework: react
    api Shop: ShopApi
    ${members}
  }
  storage primarySql { type: postgres }
  resource shopState { for: Shop, kind: state, use: primarySql }
  deployable api { platform: node contexts: [Shop] dataSources: [shopState] serves: ShopApi port: 3000 }
  deployable web { platform: static targets: api ui: Web { Shop: api } port: 3001 }
}`;

async function diags(members: string) {
  const { model, errors } = await parseString(wrap(members));
  if (errors.length) throw new Error(`unexpected parse errors:\n${errors.join("\n")}`);
  return validateLoomModel(enrichLoomModel(lowerModel(model)));
}

const codes = async (members: string): Promise<string[]> =>
  (await diags(members)).map((d) => d.code);

const messageFor = async (members: string): Promise<string> => {
  const hit = (await diags(members)).find((d) => d.code === CODE);
  if (!hit) throw new Error(`${CODE} did not fire`);
  return hit.message;
};

describe("loom.destroy-form-of-unresolved — the gate", () => {
  // --- branch 1: the `of:` argument is not a plain ref -----------------------
  it("flags the POSITIONAL spelling, which passes no `of:` at all", async () => {
    expect(
      await codes(`page A(id: Item id) { route: "/a/:id"
      body: Stack { DestroyForm { Item } } }`),
    ).toContain(CODE);
  });

  it("flags an `of:` that is a member access, not an aggregate type", async () => {
    expect(
      await codes(`page A { route: "/a"
      body: QueryView {
        of: Shop.Item.all,
        single: true,
        loading: Skeleton { count: 1 },
        error: Alert { "err" },
        empty: Empty { "none" },
        data: row => DestroyForm { of: row.name }
      } }`),
    ).toContain(CODE);
  });

  // --- branch 2: the ref resolves to no aggregate ---------------------------
  it("flags a value-object name — resolvable, but not an aggregate", async () => {
    expect(
      await codes(`page A(id: Item id) { route: "/a/:id"
      body: Stack { DestroyForm { of: Gadget } } }`),
    ).toContain(CODE);
  });

  it("flags a `QueryView` ROW BINDING spelled as the aggregate type", async () => {
    // The exact shape docs/language-reference/16 recorded as "not rejected
    // today — it degrades to a `DestroyForm(of: p): aggregate not found`
    // comment on every target".
    expect(
      await codes(`page A { route: "/a"
      body: QueryView {
        of: Shop.Item.all,
        single: true,
        loading: Skeleton { count: 1 },
        error: Alert { "err" },
        empty: Empty { "none" },
        data: p => DestroyForm { of: p }
      } }`),
    ).toContain(CODE);
  });

  // --- branch 3: the aggregate has no canonical destroy ---------------------
  it("flags an aggregate that declares no canonical destroy", async () => {
    expect(
      await codes(`page A(id: Note id) { route: "/a/:id"
      body: Stack { DestroyForm { of: Note } } }`),
    ).toContain(CODE);
  });

  // --- the two negative controls -------------------------------------------
  it("stays quiet on a `with crudish` aggregate", async () => {
    expect(
      await codes(`page A(id: Item id) { route: "/a/:id"
      body: Stack { DestroyForm { of: Item } } }`),
    ).not.toContain(CODE);
  });

  it("stays quiet on an aggregate with an explicit `destroy { }`", async () => {
    expect(
      await codes(`page A(id: Ledger id) { route: "/a/:id"
      body: Stack { DestroyForm { of: Ledger } } }`),
    ).not.toContain(CODE);
  });

  // --- it must cover components too, not only pages -------------------------
  it("flags the same form in a `component` body", async () => {
    expect(
      await codes(`
      component DangerZone() { body: Stack { DestroyForm { of: Note } } }
      page A(id: Note id) { route: "/a/:id"  body: Stack { DangerZone { } } }`),
    ).toContain(CODE);
  });

  // --- dedupe ---------------------------------------------------------------
  it("reports each offending `of:` once per host", async () => {
    const raised = (
      await codes(`page A(id: Note id) { route: "/a/:id"
        body: Stack { DestroyForm { of: Note }, DestroyForm { of: Note } } }`)
    ).filter((c) => c === CODE);
    expect(raised).toHaveLength(1);
  });

  // --- the wording the mission asks for -------------------------------------
  it("names both spellings that give an aggregate a canonical destroy", async () => {
    const msg = await messageFor(`page A(id: Note id) { route: "/a/:id"
      body: Stack { DestroyForm { of: Note } } }`);
    expect(msg).toContain("with crudish");
    expect(msg).toContain("destroy { }");
  });

  it("says `of:` takes the aggregate TYPE, not a record instance or a lambda binding", async () => {
    const msg = await messageFor(`page A { route: "/a"
      body: QueryView {
        of: Shop.Item.all,
        single: true,
        loading: Skeleton { count: 1 },
        error: Alert { "err" },
        empty: Empty { "none" },
        data: p => DestroyForm { of: p }
      } }`);
    expect(msg).toContain("aggregate TYPE");
    expect(msg).toContain("record instance");
    expect(msg).toContain("lambda binding");
  });

  it("is an error, not a warning", async () => {
    const hit = (
      await diags(`page A(id: Note id) { route: "/a/:id"
        body: Stack { DestroyForm { of: Note } } }`)
    ).find((d) => d.code === CODE)!;
    expect(hit.severity).toBe("error");
  });
});

// Money inside a dynamic row (`VO[]` + `CreateForm`) is never a JS number —
// and, since #2902, never a bare string either: the row cell holds the same
// constructed `Decimal` the flat money field holds.
//
// M-T1.24 seam 2 (numeric-types audit F5) is the FIRST half of this file's
// history: `field-input-money` used to sit in the `NUMERIC` set of
// `src/generator/_walker/form-fields-vm.ts`, so an array-row money sub-field
// registered `{ valueAsNumber: true }` and the fresh-row seed was the JS number
// `0`.  Both break the money contract — `moneySchema` is
// `z.union([z.instanceof(Decimal), z.string()])`, so a number never validates,
// and had it validated the wire would have carried a JSON number instead of the
// decimal string the backends parse.
//
// The e-shop audit's P8 is the SECOND half.  The row cell is a per-pack
// renderer (`field-input-array.hbs`) that shares no markup with the flat
// `field-input-money.hbs`, so when #2876 taught every flat arm to hold a real
// `Decimal`, the row arms stayed on the generic string arm and the seed stayed
// the string `"0"`.  That is a type error wherever form state is typed on the
// schema's OUTPUT: `moneySchema`'s output is `Decimal`, and Vue's and Svelte's
// `FormValues<z.infer<S>>` bind exactly that (`TS2322: Type 'string' is not
// assignable to type 'Decimal'`).  React types its form on `z.input`
// (`Decimal | string`), which is why its own compile gate stayed green.
//
// So the money cell must register through a `setValueAs` arm that CONSTRUCTS a
// Decimal from the raw input string, and the fresh-row seed must be
// `new Decimal("0")` — never `0` (seam 2's defect) and never `"0"` (P8's).
//
// The `int` sibling in the same row is the control: it keeps `valueAsNumber`
// and the numeric `0` seed, so this stays a money-only change.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const SRC = (platform: string, design: string) => `
system Shop {
  api ShopApi from Sales
  subdomain Sales {
    context Ordering {
      valueobject Fee { label: string  amount: money  qty: int }
      aggregate Invoice with crudish {
        reference: string
        fees: Fee[]
      }
      repository Invoices for Invoice { }
    }
  }
  storage db { type: postgres }
  resource ordState { for: Ordering, kind: state, use: db }
  ui WebApp with scaffold(subdomains: [Sales]) { api Shop: ShopApi }
  deployable api { platform: node contexts: [Ordering] dataSources: [ordState] serves: ShopApi port: 3000 }
  deployable web { platform: ${platform} targets: api ui: WebApp { Shop: api } port: 3005 design: ${design} }
}
`;

async function newPage(platform: string, design: string, suffix: string): Promise<string> {
  const files = await generateSystemFiles(SRC(platform, design));
  return [...files.entries()].find(([p]) => p.endsWith(suffix))![1];
}

/** A row seed of `amount: 0` (seam 2) or `amount: "0"` (P8) — the two shapes
 *  that must never come back.  Anchored on the delimiter so the passing shape,
 *  `amount: new Decimal("0")`, can't accidentally satisfy it. */
const BAD_MONEY_SEED = /amount: (?:0|"0")\s*[,}]/;

/** `valueAsNumber` anywhere in the money cell's `register(...)` option list. */
const MONEY_REGISTERED_AS_NUMBER = /fees\.\$\{index\}\.amount`,\s*\{ valueAsNumber/;

// mantine / mui / chakra destructure `register` off `useForm`; shadcn keeps the
// whole `form` object and registers through `form.register`.
const REACT_PACKS: { design: string; reg: string }[] = [
  { design: "mantine", reg: "register" },
  { design: "mui", reg: "register" },
  { design: "chakra", reg: "register" },
  { design: "shadcn", reg: "form.register" },
];

describe.each(REACT_PACKS)("react money array row — $design", ({ design, reg }) => {
  const page = () => newPage("react", design, "pages/invoices/new.tsx");

  it("registers the money sub-field through a Decimal setValueAs, not valueAsNumber", async () => {
    const tsx = await page();
    // RHF hands `register` the raw input string; `setValueAs` is what turns it
    // into the `Decimal` form state is declared to hold.
    expect(tsx).toContain(
      `{...${reg}(\`fees.\${index}.amount\`, { setValueAs: (v: string) => { try { return new Decimal(v || "0"); } catch { return new Decimal("0"); } } })}`,
    );
    expect(tsx).not.toMatch(MONEY_REGISTERED_AS_NUMBER);
    // The generic string arm the cell used to fall through to registers with no
    // options at all.
    expect(tsx).not.toContain(`{...${reg}(\`fees.\${index}.amount\`)}`);
  });

  it("imports the Decimal the row cell constructs", async () => {
    const tsx = await page();
    expect(tsx).toMatch(/import (\{ )?Decimal( \})? from "decimal\.js"/);
  });

  it("still coerces the int sibling via valueAsNumber", async () => {
    const tsx = await page();
    expect(tsx).toContain(`{...${reg}(\`fees.\${index}.qty\`, { valueAsNumber: true })}`);
  });

  it("seeds a fresh row with a constructed Decimal for money and the number 0 for int", async () => {
    const tsx = await page();
    expect(tsx).toContain('appendFees({ label: "", amount: new Decimal("0"), qty: 0 })');
    expect(tsx).not.toMatch(BAD_MONEY_SEED);
  });
});

describe("svelte money array row — shadcnSvelte", () => {
  it("pushes a fresh row whose money seed is a constructed Decimal", async () => {
    const page = await newPage("svelte", "shadcnSvelte", "invoices/new/+page.svelte");
    expect(page).toContain(
      'form.values.fees.push({ label: "", amount: new Decimal("0"), qty: 0 })',
    );
    expect(page).not.toMatch(BAD_MONEY_SEED);
    // …and the cell reads that Decimal back out instead of binding it raw.
    expect(page).toContain("form.values.fees[index].amount instanceof Decimal");
  });
});

describe("vue money array row — shadcnVue", () => {
  it("pushes a fresh row whose money seed is a constructed Decimal", async () => {
    const vue = await newPage("vue", "shadcnVue", "pages/invoices/new.vue");
    expect(vue).toContain('form.values.fees.push({ label: "", amount: new Decimal("0"), qty: 0 })');
    expect(vue).not.toMatch(BAD_MONEY_SEED);
    expect(vue).toContain("form.values.fees[index].amount instanceof Decimal");
  });
});

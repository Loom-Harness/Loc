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
// The `int` sibling in the same row is the control: it keeps its own int input
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

/** The text of the row cell bound at `fees.${index}.<sub>`: from its `name=`
 *  binding to the next bound cell / the row's Remove button, so a sibling's
 *  text can't leak in. */
function rowCell(tsx: string, sub: string): string {
  const at = tsx.indexOf(`name={\`fees.\${index}.${sub}\`}`);
  expect(at, `no row cell bound at fees.\${index}.${sub}`).toBeGreaterThan(-1);
  const stops = [tsx.indexOf("name={`", at + 1), tsx.indexOf("removeFees(index)", at)].filter(
    (i) => i > -1,
  );
  return tsx.slice(at, Math.min(at + 900, ...stops));
}

const REACT_PACKS = ["mantine", "mui", "chakra", "shadcn"];

describe.each(REACT_PACKS)("react money array row — %s", (design) => {
  const page = () => newPage("react", design, "pages/invoices/new.tsx");

  it("binds the money sub-field through the pack's Decimal-producing money input, not valueAsNumber", async () => {
    const tsx = await page();
    // The row cell is the pack's `field-input-money` Controller: its onChange
    // constructs the `Decimal` form state is declared to hold.
    const cell = rowCell(tsx, "amount");
    expect(cell).toMatch(
      /field\.onChange\(new Decimal\(e\.(?:currentTarget|target)\.value \|\| "0"\)\)/,
    );
    expect(cell).toContain("-input-fees-${index}-amount");
    expect(cell).not.toContain("valueAsNumber");
    expect(tsx).not.toContain("register(`fees.${index}.amount`");
  });

  it("imports the Decimal the row cell constructs", async () => {
    const tsx = await page();
    expect(tsx).toMatch(/import (\{ )?Decimal( \})? from "decimal\.js"/);
  });

  it("binds the int sibling through the pack's int input, not a money one", async () => {
    const tsx = await page();
    const cell = rowCell(tsx, "qty");
    expect(cell).toContain("-input-fees-${index}-qty");
    expect(cell).not.toContain("new Decimal(");
    expect(tsx).not.toContain("register(`fees.${index}.qty`");
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

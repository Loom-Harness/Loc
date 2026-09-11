// Ledger row `flutter-form-field-drops`, shapes 2–4 — the three array form
// fields Flutter used to drop as `// TODO(flutter form-field): …` comments:
//
//   2. a value-object array whose element carries a NON-SCALAR sub-field
//      (`lines: LineItem[]`, `LineItem { sku: string  active: bool … }`) — the
//      row editor rendered text/number cells only, so ONE bool sub-field
//      deferred the whole array;
//   3. a bool element array (`flags: bool[]`);
//   4. an enum element array (`colors: Color[]`).
//
// All three are real widgets now: a per-row checkbox / dropdown / date picker
// for the VO cells, and repeatable checkbox and dropdown row editors for the
// element arrays.  The wire shape is unchanged — `[true, false]` and
// `["red"]` and `[{sku, active, shade, due}]` are what the backend's request
// schema already expected; the last test reads that expectation off the BACKEND
// rather than off the Flutter emitter.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";
import { dartBracketImbalance } from "./_dart-balance.js";

const SRC = `
system S {
  api A from D
  subdomain D { context C {
    enum Color { red  green }
    valueobject LineItem { sku: string  qty: int  active: bool  shade: Color  due: datetime }
    aggregate Order {
      ref: string
      lines: LineItem[]
      flags: bool[]
      colors: Color[]
    }
    repository Orders for Order {}
  } }
  storage db { type: postgres }
  resource st { for: C, kind: state, use: db }
  ui App {
    framework: flutter
    api Shop: A
    page NewOrder { route: "/orders/new"  body: Stack { Heading { "New", level: 1 }, CreateForm { of: Order } } }
  }
  deployable api1 { platform: node contexts: [C] dataSources: [st] serves: A port: 8081 }
  deployable app { platform: flutter targets: api1 ui: App { Shop: api1 } port: 3006 }
}
`;

async function formsDart(): Promise<string> {
  const files = await generateSystemFiles(SRC);
  const forms = [...files.entries()].find(([k]) => k.endsWith("lib/forms.dart"));
  expect(forms, "no lib/forms.dart").toBeDefined();
  return forms![1];
}

describe("flutter bool / enum element arrays", () => {
  it("renders a repeatable checkbox editor for a bool[] and submits a List<bool>", async () => {
    const src = await formsDart();
    expect(src).toContain("final List<bool> _flagsValues = [];");
    // Each row edits its own slot; Add seeds `false`, Remove drops the row.
    expect(src).toContain(
      "Checkbox(value: entry.value, onChanged: (v) => setState(() => _flagsValues[entry.key] = v ?? false))",
    );
    expect(src).toContain("_flagsValues.add(false)");
    expect(src).toContain("_flagsValues.removeAt(entry.key)");
    expect(src).toContain("'flags': _flagsValues.toList(),");
  });

  it("renders a repeatable dropdown editor for an enum[] and seeds new rows", async () => {
    const src = await formsDart();
    expect(src).toContain("final List<String> _colorsValues = [];");
    expect(src).toContain("DropdownMenuItem(value: 'red', child: Text('red'))");
    expect(src).toContain("DropdownMenuItem(value: 'green', child: Text('green'))");
    // A new row seeds the FIRST declared value, so the submitted list never
    // carries a null the wire would reject.
    expect(src).toContain("_colorsValues.add('red')");
    expect(src).toContain("'colors': _colorsValues.toList(),");
  });

  it("no form-field drop marker survives for any of the three shapes", async () => {
    expect(await formsDart()).not.toContain("TODO(flutter form-field)");
  });
});

describe("flutter value-object array with non-scalar cells", () => {
  it("renders a checkbox / dropdown / date-picker cell per non-text sub-field", async () => {
    const src = await formsDart();
    // The row slot is heterogeneous: controllers for text/number, values for
    // bool/enum/datetime.
    expect(src).toContain("final List<List<dynamic>> _linesRows = [];");
    expect(src).toContain("controller: row[0] as TextEditingController");
    expect(src).toContain(
      "Checkbox(value: row[2] as bool, onChanged: (v) => setState(() => row[2] = v ?? false))",
    );
    expect(src).toContain("DropdownButtonFormField<String>(initialValue: row[3] as String?");
    expect(src).toContain("initialDate: row[4] as DateTime? ?? DateTime.now()");
    // A fresh row carries one slot per sub-field, of the matching shape.
    expect(src).toContain(
      "_linesRows.add(<dynamic>[TextEditingController(), TextEditingController(), false, 'red', null])",
    );
    // Only the controller slots are disposed.
    expect(src).toContain(
      "for (final c in removed) { if (c is TextEditingController) c.dispose(); }",
    );
  });

  it("submits one map per row, reading each cell out of its own slot", async () => {
    const src = await formsDart();
    expect(src).toContain(
      "'lines': _linesRows.map((row) => <String, dynamic>{'sku': (row[0] as TextEditingController).text, 'qty': int.tryParse((row[1] as TextEditingController).text), 'active': row[2] as bool, 'shade': row[3] as String?, 'due': (row[4] as DateTime?)?.toIso8601String()}).toList(),",
    );
  });

  it("the emitted Dart's brackets balance", async () => {
    // The array editors are long single-line widget trees; an off-by-one closing
    // paren is the one defect substring assertions cannot see.
    expect(dartBracketImbalance(await formsDart())).toBeUndefined();
  });

  it("the element shapes match the BACKEND's own request schema", async () => {
    // Rule 12 — the expectation comes from outside the Flutter emitter: the
    // Hono backend generated alongside declares the element types, so a Flutter
    // change that submits (say) enum rows as ints fails here.
    const files = await generateSystemFiles(SRC);
    const routes = [...files.entries()].find(([k]) => k.endsWith("http/order.routes.ts"));
    expect(routes, "no order.routes.ts").toBeDefined();
    const api = routes![1];
    expect(api).toContain("flags: z.array(z.boolean())");
    expect(api).toContain("colors: z.array(ColorSchema)");
    expect(api).toContain("lines: z.array(LineItemSchema)");
    expect(api).toMatch(/const LineItemSchema = z\.object\(\{[\s\S]*?active: z\.boolean\(\),/);
  });
});

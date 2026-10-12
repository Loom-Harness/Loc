import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

// ---------------------------------------------------------------------------
// #15d / ruling D10 — a MESSAGE-LESS single-field rule answers the SAME
// message on python as on node.
//
// Node's zod chain carries `singleFieldMessage(field, pattern)` ("Billing Email
// is not in the expected format").  Python armed the same check as a native
// pydantic `Field(pattern=…)`, whose default text reached the wire verbatim —
// `String should match pattern '^[^@]+@[^@]+\.[^@]+$'`, the regex itself — and
// diverged from node on every other bound shape too (`Input should be greater
// than or equal to 1`).  Python now re-words each constraint violation through a
// per-model `field_validator(mode="wrap")` table built from the SAME
// single-field classification node chains from.
//
// The parity check is DERIVED, not hard-coded: every validation message node's
// route module attaches must appear in python's tables, so a wording change on
// either side fails here instead of on a booted leg.
// ---------------------------------------------------------------------------

const fixture = (platform: string) => `system S {
  subdomain Sales {
    context Billing {
      valueobject Zip {
        code: string
        invariant code.length >= 4 && code.length <= 10
      }
      aggregate Customer {
        billingEmail: string
        seats: int
        discount: decimal
        tag: string
        handle: string
        contact: string
        zip: Zip
        invariant billingEmail.matches("^[^@]+@[^@]+\\\\.[^@]+$")
        invariant seats >= 1 && seats <= 500
        invariant discount > 0.5
        invariant tag.length == 3
        invariant handle.length >= 2 && handle.length <= 20
        invariant contact.matches("^[a-z]+$") && contact.length <= 12
        create(billingEmail: string, seats: int, discount: decimal, tag: string, handle: string, contact: string, zip: Zip) {
          billingEmail := billingEmail
          seats := seats
          discount := discount
          tag := tag
          handle := handle
          contact := contact
          zip := zip
        }
        operation resize(count: int) {
          precondition count >= 1
          seats := count
        }
      }
      repository Customers for Customer { }
    }
  }
  api BillingApi from Sales
  storage db { type: postgres }
  resource st { for: Billing, kind: state, use: db }
  deployable api { platform: ${platform} contexts: [Billing] dataSources: [st] serves: BillingApi port: 8080 }
}
`;

function find(fs: Map<string, string>, suffix: string): string {
  const key = [...fs.keys()].find((k) => k.endsWith(suffix));
  if (!key) throw new Error(`no generated file ending in ${suffix}`);
  return fs.get(key)!;
}

/** Every validation `message: "…"` node's Customer route module attaches to a
 *  request schema — native chains and refines alike (the fixture authors no
 *  `message` clause, so each is a synthesized sentence or the derived default). */
function nodeMessages(fs: Map<string, string>): Set<string> {
  const out = new Set<string>();
  const src = find(fs, "http/customer.routes.ts");
  for (const m of src.matchAll(/message: ("(?:[^"\\]|\\.)*")/g)) {
    out.add(JSON.parse(m[1]!) as string);
  }
  return out;
}

describe("python — a message-less single-field rule answers node's message (#15d, D10)", () => {
  it("re-words the regex constraint instead of leaking the pattern", async () => {
    const routes = find(await generateSystemFiles(fixture("python")), "http/customer_routes.py");
    // The check itself is still the native, schema-publishing constraint.
    expect(routes).toContain('billingEmail: WireStr = Field(pattern=r"^[^@]+@[^@]+\\.[^@]+$")');
    // ...and its violation is re-worded per field + pydantic error type.
    expect(routes).toContain(
      '@field_validator("billingEmail", "seats", "discount", "tag", "handle", "contact", mode="wrap")',
    );
    expect(routes).toContain(
      '("billingEmail", "string_pattern_mismatch"): "Billing Email is not in the expected format",',
    );
    expect(routes).toContain('raise PydanticCustomError(e["type"], hit) from None');
    // Only the errors the table arms are rewritten; a type error re-raises.
    expect(routes).toContain('if hit is not None and not e["loc"]:');
    expect(routes).toMatch(
      /from pydantic import [^\n]*ValidationInfo, ValidatorFunctionWrapHandler, field_validator/,
    );
  });

  it("maps every bound shape to the pydantic error type its Field kwarg raises", async () => {
    const py = await generateSystemFiles(fixture("python"));
    const routes = find(py, "http/customer_routes.py");
    for (const entry of [
      // A recognised compound is ONE node sentence, though two pydantic kwargs.
      '("seats", "greater_than_equal"): "Seats must be between 1 and 500",',
      '("seats", "less_than_equal"): "Seats must be between 1 and 500",',
      '("discount", "greater_than"): "Discount must be greater than 0.5",',
      '("tag", "string_too_short"): "Tag must be exactly 3 characters",',
      '("tag", "string_too_long"): "Tag must be exactly 3 characters",',
      '("handle", "string_too_short"): "Handle must be 2 to 20 characters",',
      '("handle", "string_too_long"): "Handle must be 2 to 20 characters",',
      // A message-less precondition rides the op request's own table.
      '("count", "greater_than_equal"): "Count must be at least 1",',
      // A conjunction node does NOT chain natively rides its zod refine, whose
      // message is the derived default — python sends that, not a per-conjunct
      // sentence node never sends.
      '("contact", "string_pattern_mismatch"): "Invariant violated: contact.matches(\\"^[a-z]+$\\") && contact.length <= 12",',
      '("contact", "string_too_long"): "Invariant violated: contact.matches(\\"^[a-z]+$\\") && contact.length <= 12",',
    ]) {
      expect(routes).toContain(entry);
    }
    // The value-object wire model carries its own table.
    expect(find(py, "http/wire_models.py")).toContain(
      '("code", "string_too_short"): "Code must be 4 to 10 characters",',
    );
  });

  it("every message node's Customer route sends is a message python sends", async () => {
    const node = nodeMessages(await generateSystemFiles(fixture("node")));
    const py = await generateSystemFiles(fixture("python"));
    const pyText = find(py, "http/customer_routes.py") + find(py, "http/wire_models.py");
    // The derived set must be non-trivial, or this asserts nothing.
    expect(node.size).toBeGreaterThanOrEqual(8);
    for (const msg of node) expect(pyText).toContain(`: ${JSON.stringify(msg)},`);
  });

  it("emits no wrap validator for a model with no single-field constraint", async () => {
    const src = fixture("python")
      .replace(/ {8}invariant [^\n]*\n/g, "")
      .replace(/ {10}precondition [^\n]*\n/g, "");
    const routes = find(await generateSystemFiles(src), "http/customer_routes.py");
    expect(routes).not.toContain("field_validator");
    expect(routes).not.toContain("ValidatorFunctionWrapHandler");
  });
});

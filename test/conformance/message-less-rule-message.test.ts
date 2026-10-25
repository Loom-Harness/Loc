import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

// ---------------------------------------------------------------------------
// RS-41 / D-MESSAGELESS-DEFAULT — a message-LESS wire rule refuses with the
// sentence node's validator chain sends for it, on every backend.
//
// The expected set is DERIVED from node's emitted route module (every
// `message: "…"` its request schemas attach), not hard-coded, so a wording
// change on node moves the contract and every backend that does not follow
// fails here instead of on a booted leg.  Before the ruling .NET sent
// FluentValidation's `'Seats' must be between 1 and 500.`, java the generic
// `Invariant violated: …` for a shape it had classified as single-field,
// elixir answered a message-less precondition from the domain floor, and
// python prefixed a message-less model-level invariant with "Value error, " at
// an empty pointer.
// ---------------------------------------------------------------------------

const fixture = (platform: string) => `system S {
  subdomain Sales {
    context Billing {
      aggregate Customer {
        billingEmail: string
        seats: int
        tag: string
        handle: string
        invariant billingEmail.matches("^[^@]+@[^@]+\\\\.[^@]+$")
        invariant seats >= 1 && seats <= 500
        invariant tag.length == 3
        invariant handle.trim().length > 0
        create(billingEmail: string, seats: int, tag: string, handle: string) {
          billingEmail := billingEmail
          seats := seats
          tag := tag
          handle := handle
        }
        operation resize(count: int) {
          precondition count >= 1
          seats := count
        }
        operation retag(code: string) {
          precondition code.matches("^[A-Z]{3}$")
          tag := code
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

function all(fs: Map<string, string>, ext: string): string {
  return [...fs]
    .filter(([k]) => k.endsWith(ext))
    .map(([, v]) => v)
    .join("\n");
}

/** Every validation message node's Customer route module attaches. */
async function nodeMessages(): Promise<Set<string>> {
  const src = find(await generateSystemFiles(fixture("node")), "http/customer.routes.ts");
  const out = new Set<string>();
  for (const m of src.matchAll(/message: ("(?:[^"\\]|\\.)*")/g)) out.add(JSON.parse(m[1]!));
  return out;
}

describe("RS-41 — a message-less rule answers node's sentence on every backend", () => {
  it("the derived set covers every rule shape the fixture declares", async () => {
    const node = await nodeMessages();
    expect([...node].sort()).toEqual(
      [
        "Billing Email is not in the expected format",
        "Code is not in the expected format",
        "Count must be at least 1",
        "Invariant violated: handle.trim().length > 0",
        "Seats must be between 1 and 500",
        "Tag must be exactly 3 characters",
      ].sort(),
    );
  });

  it(".NET: each FluentValidation rule carries node's sentence, never the framework default", async () => {
    const cs = all(await generateSystemFiles(fixture("dotnet")), ".cs");
    for (const msg of await nodeMessages()) {
      expect(cs, `.NET does not send "${msg}"`).toContain(`.WithMessage(${JSON.stringify(msg)})`);
    }
    // FluentValidation's own sentence shape must not reach the wire.
    expect(cs).not.toMatch(/WithMessage\("'\{PropertyName\}'/);
  });

  it("java: each single-field rule carries node's sentence, not the refine default", async () => {
    // The request VALIDATORS — the domain floor (`DomainException`) keeps its
    // own "Invariant violated: …" text, as it does on node.
    const java = all(await generateSystemFiles(fixture("java")), "Validator.java");
    for (const msg of await nodeMessages()) {
      expect(java, `java does not send "${msg}"`).toContain(JSON.stringify(msg));
    }
    expect(java).not.toContain('"Invariant violated: count >= 1"');
    expect(java).not.toContain('"Invariant violated: seats >= 1 && seats <= 500"');
  });

  it("elixir: a message-less precondition denies on the errors[] rung, with node's sentence and no code", async () => {
    const ex = all(await generateSystemFiles(fixture("elixir")), ".ex");
    expect(ex).toContain(
      '{:validation_failed, [%{pointer: "/count", message: "Count must be at least 1"}]}',
    );
    expect(ex).toContain(
      '{:validation_failed, [%{pointer: "/code", message: "Code is not in the expected format"}]}',
    );
    // The responder renders a code-less entry.
    expect(ex).toContain("defp render_wire_error(%{pointer: pointer, message: message}) do");
  });

  it("python: a message-less model-level invariant raises a typed error at its field", async () => {
    const routes = find(await generateSystemFiles(fixture("python")), "http/customer_routes.py");
    expect(routes).not.toContain('raise ValueError("Invariant violated');
    expect(routes).toMatch(
      /type=PydanticCustomError\("invariant", "Invariant violated: handle\.trim\(\)\.length > 0"\),\s+loc=\("handle",\),/,
    );
  });
});

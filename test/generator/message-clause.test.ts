import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

// ---------------------------------------------------------------------------
// Custom validation messages — the `message "..."` clause on
// invariant / check / precondition (M-T1.11 foundation slice, Hono/React
// vertical).  A messaged rule renders through the wire refine carrier (with
// the author text + a stable `loomCode`) and the domain floor; a message-less
// rule keeps its native chain byte-identical.
// ---------------------------------------------------------------------------

const SOURCE = `
  system S {
    subdomain Sales {
      context Cat {
        aggregate Product {
          sku: string check sku.length > 0 message "SKU is required"
          name: string
          invariant name.length >= 2 && name.length <= 120 message "Name must be 2-120 characters"
          invariant sku.length > 0
          // Empty body on purpose: on a state-based aggregate the canonical
          // create's assignments are DROPPED (loom.lifecycle-body-dropped) —
          // each field takes its value from the request body.  The declaration
          // is still what makes the aggregate constructible.
          create(name: string, sku: string) { }
          operation restock(amount: int) {
            precondition amount >= 1 message "Amount must be positive"
            name := name
          }
        }
        repository Products for Product { }
      }
    }
    api CatApi from Sales
    ui Web { api Sales: CatApi page P { route: "/" body: CreateForm { of: Product } } }
    storage db { type: postgres }
    resource st { for: Cat, kind: state, use: db }
    deployable api { platform: node contexts: [Cat] dataSources: [st] serves: CatApi port: 8080 }
    deployable web { platform: react targets: api ui: Web { Sales: api } port: 3000 }
  }
`;

async function gen() {
  const all = await generateSystemFiles(SOURCE);
  return {
    reactApi: all.get("web/src/api/product.ts")!,
    domain: all.get("api/domain/product.ts")!,
    problem: all.get("api/http/problem-details.ts")!,
  };
}

describe("message clause — wire refine carrier", () => {
  it("renders a messaged check as a refine with its text", async () => {
    const { reactApi } = await gen();
    expect(reactApi).toContain('message: "SKU is required"');
  });

  it("keeps a message-LESS invariant on the native chain", async () => {
    const { reactApi } = await gen();
    // `invariant sku.length > 0` (no message) stays on the chain rather than
    // becoming a messaged refine.  A string LENGTH bound is a code-point
    // predicate, not zod's code-unit `.min` (RS-31).
    expect(reactApi).toContain(
      'sku: z.string().refine((s) => [...s].length >= 1, { message: "Sku must be at least 1 character" })',
    );
  });
});

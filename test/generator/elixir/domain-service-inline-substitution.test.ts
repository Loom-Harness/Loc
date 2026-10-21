// A `mutating` domainService inlines into the calling workflow's with-chain on
// Elixir: each param-op call in the service body becomes a context mutating-fn
// clause whose args have the service's params replaced by the workflow's call
// args.  That replacement must reach every child slot — a service param read
// only inside a `days(n)` duration (or a conversion, a list, a `match` arm) was
// left as `n`, so the inlined clause named a variable the workflow never bound:
// `undefined variable "n"` on `mix compile`, on a model that validated clean.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = `
system Shop {
  subdomain Sales {
    context Orders {
      aggregate Order with crudish {
        until: datetime
        operation extend(at: datetime) { until := at }
      }
      repository Orders for Order { }
      domainService Bumper {
        operation bump(target: Order, n: int) {
          target.extend(now() + days(n))
        }
      }
      workflow BumpOrder transactional {
        create(id: Order id, k: int) {
          let o = Orders.getById(id)
          Bumper.bump(o, k)
        }
      }
    }
  }
  storage primary { type: postgres }
  resource ordersState { for: Orders, kind: state, use: primary }
  deployable api {
    platform: elixir
    contexts: [Orders]
    dataSources: [ordersState]
    port: 4000
  }
}
`;

describe("elixir mutating domainService inlining substitutes params at any depth", () => {
  it("replaces a service param read inside a duration with the workflow's call arg", async () => {
    const files = await generateSystemFiles(SRC);
    const key = [...files.keys()].find((k) => k.endsWith("workflows/bump_order.ex"));
    expect(key, "workflow module not emitted").toBeDefined();
    const wf = files.get(key!)!;
    expect(wf).toContain("Context.extend_order(o, %{");
    expect(wf).toContain("((k) * 86400000)");
    expect(wf).not.toContain("((n) * 86400000)");
  });
});

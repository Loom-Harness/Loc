import { describe, expect, it } from "vitest";
import { expectEmitted } from "../../_helpers/emitted.js";
import { generateSystemFiles } from "../../_helpers/generate.js";

// M-T6.74 N5 — node `toWire` guarded an optional value object / datetime /
// money field TWICE: the `optional` arm wrapped `x == null ? null : …` and
// then handed `optional: true` to the inner arm, which emitted the same guard
// again — `(root.addr == null ? null : (root.addr == null ? null : { … }))`.

const SRC = `
system OptVo {
  subdomain C {
    context C {
      valueobject Addr {
        street: string
        zip: string
      }
      aggregate Shop {
        name: string
        addr: Addr?
        openedAt: datetime?
        create(name: string, addr: Addr?, openedAt: datetime?) {
          name := name
          addr := addr
          openedAt := openedAt
        }
      }
      repository Shops for Shop { }
    }
  }
  api CApi from C
  storage primary { type: postgres }
  resource cState { for: C, kind: state, use: primary }
  deployable d {
    platform: node
    contexts: [C]
    dataSources: [cState]
    serves: CApi
    port: 4000
  }
}
`;

describe("node toWire — one null guard per optional field", () => {
  it("an optional value object / datetime is guarded exactly once", async () => {
    const files = await generateSystemFiles(SRC);
    const repo = expectEmitted(files, "d/db/repositories/shop-repository.ts");
    const toWire = repo.slice(repo.indexOf("toWire(root: Shop)"));
    const body = toWire.slice(0, toWire.indexOf("\n  }"));
    expect(body).toContain(
      "addr: (root.addr == null ? null : { street: root.addr.street, zip: root.addr.zip })",
    );
    expect(body.split("root.addr == null").length - 1).toBe(1);
    expect(body.split("root.openedAt == null").length - 1).toBe(1);
  });
});

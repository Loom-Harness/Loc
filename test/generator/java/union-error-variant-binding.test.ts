// End-to-end companion to the `matchVariant` leaf pins in
// `render-expr-kinds.test.ts` — audit F59 / M-T6.61.
//
// A variant `match` over a union that carries an `error` variant emitted
// `case null -> n.resource();` on Java: the arm collapsed to the null pattern
// and the bound `n` was declared nowhere, so `gradle bootJar` failed with
// "cannot find symbol: variable n".  Node emits the same match correctly
// (`r.type === "Hit" ? r.code : r.resource`), and a union with two NON-error
// variants was correct on Java too — the misfiring shape was exactly one
// success + one error.
//
// The unit pins prove the leaf; this proves the PIPELINE reaches it — the
// union has to come from a `domainService` operation return (whose
// `<Union>_<Tag>` carrier records the Java emitter really does write), not a
// repository union find, whose optional-twin shape is intercepted upstream.
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = `
system S {
  subdomain Core {
    context Shop {
      error NotFound { resource: string }
      payload Hit { code: string }

      aggregate Order {
        code: string
        create(code: string) { }
      }

      domainService Lookup {
        operation probe(code: string): Hit or NotFound {
          if (code.length > 0) {
            return Hit { code: code }
          }
          return NotFound { resource: code }
        }
      }

      workflow claim {
        owner: string
        create(code: string) {
          let r = Lookup.probe(code)
          owner := match r { Hit h => h.code, NotFound n => n.resource }
        }
      }
    }
  }
  api A from Core
  storage pg { type: postgres }
  resource shopState { for: Shop, kind: state, use: pg }
  deployable jsvc { platform: java  contexts: [Shop]  serves: A  dataSources: [shopState]  port: 8081 }
}
`;

async function workflows(): Promise<string> {
  const files = await generateSystemFiles(SRC);
  const key = [...files.keys()].find((k) => k.endsWith("application/workflows/ShopWorkflows.java"));
  expect(key, "ShopWorkflows.java not emitted").toBeDefined();
  return files.get(key as string) as string;
}

describe("java — a match over an `error` variant binds the arm's name", () => {
  it("the error arm is a carrier pattern that declares `n`", async () => {
    const wf = await workflows();
    expect(wf).toContain("case HitOrNotFound_NotFound n -> n.resource();");
  });

  it("the collapsed `case null` form is gone", async () => {
    // Presence-only would still pass if BOTH arms were emitted; this is the
    // assertion that fails on unmodified main.
    const wf = await workflows();
    expect(wf).not.toContain("case null -> n.resource();");
  });

  it("the success arm still binds its own name", async () => {
    const wf = await workflows();
    expect(wf).toContain("case HitOrNotFound_Hit h -> h.code();");
  });

  it("both carrier records the patterns name are actually emitted", async () => {
    // The arms are only compilable if the `<Union>_<Tag>` records exist — the
    // very thing the collapsed form assumed they did not.
    const files = await generateSystemFiles(SRC);
    const carrier = (n: string): string => {
      const key = [...files.keys()].find((k) => k.endsWith(`domain/services/${n}.java`));
      expect(key, `${n}.java not emitted`).toBeDefined();
      return files.get(key as string) as string;
    };
    expect(carrier("HitOrNotFound_NotFound")).toContain(
      "public record HitOrNotFound_NotFound(String resource) implements HitOrNotFound {",
    );
    expect(carrier("HitOrNotFound_Hit")).toContain(
      "public record HitOrNotFound_Hit(String code) implements HitOrNotFound {",
    );
  });
});

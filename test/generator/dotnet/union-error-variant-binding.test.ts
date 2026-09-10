// End-to-end companion to the `matchVariant` leaf pins in
// `render-expr-kinds.test.ts` — audit F59 / M-T6.61.
//
// A variant `match` over a union that carries an `error` variant emitted
// `_ => n.Resource,` on .NET: the arm collapsed to a discard pattern and the
// bound `n` was declared nowhere, so `dotnet build` failed with CS0103.  Node
// emits the same match correctly, and a union with two NON-error variants was
// correct on .NET too — the misfiring shape was exactly one success + one
// error.
//
// The unit pins prove the leaf; this proves the PIPELINE reaches it — the
// union has to come from a `domainService` operation return (whose
// `<Union>_<Tag>` carrier records the .NET emitter really does write), not a
// repository union find, whose optional-twin shape is intercepted upstream
// (see dotnet-showcase-compile-regressions.test.ts).
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
  deployable dsvc { platform: dotnet  contexts: [Shop]  serves: A  dataSources: [shopState]  port: 8082 }
}
`;

async function handler(): Promise<string> {
  const files = await generateSystemFiles(SRC);
  const key = [...files.keys()].find((k) => k.endsWith("Application/Workflows/ClaimHandler.cs"));
  expect(key, "ClaimHandler.cs not emitted").toBeDefined();
  return files.get(key as string) as string;
}

describe("dotnet — a match over an `error` variant binds the arm's name", () => {
  it("the error arm is a carrier pattern that declares `n`", async () => {
    const h = await handler();
    expect(h).toContain("HitOrNotFound_NotFound n => n.Resource,");
  });

  it("the collapsed `_ =>` discard form is gone", async () => {
    // Presence-only would still pass if BOTH arms were emitted; this is the
    // assertion that fails on unmodified main.
    const h = await handler();
    expect(h).not.toContain("_ => n.Resource,");
  });

  it("the success arm still binds its own name", async () => {
    const h = await handler();
    expect(h).toContain("HitOrNotFound_Hit h => h.Code,");
  });

  it("both carrier records the patterns name are actually emitted", async () => {
    // The arms are only compilable if the `<Union>_<Tag>` records exist — the
    // very thing the collapsed form assumed they did not.
    const files = await generateSystemFiles(SRC);
    const key = [...files.keys()].find((k) => k.endsWith("Domain/Services/HitOrNotFound.cs"));
    expect(key, "HitOrNotFound.cs not emitted").toBeDefined();
    const union = files.get(key as string) as string;
    expect(union).toContain("public sealed record HitOrNotFound_Hit(string Code) : HitOrNotFound;");
    expect(union).toContain(
      "public sealed record HitOrNotFound_NotFound(string Resource) : HitOrNotFound;",
    );
  });
});

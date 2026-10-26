import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// vanilla Phoenix — a RETURNING operation on a `versioned` aggregate.
//
// That a writing returning op bumps `version` through `optimistic_lock/2` is
// asserted by value on the elixir behavioural leg (`corpus/operation-returns`:
// `accept()` reads back `version: 3` against node's golden).  What stays here
// is the case no read distinguishes: a returning op that writes nothing builds
// no changeset at all.
// ---------------------------------------------------------------------------

const versionedSrc = (extra: string) => `
system RU {
  subdomain D {
    context Shop {
      error NotFound { resource: string }
      aggregate Order ${extra} {
        code: string
        reserved: bool
        operation accept(): string or NotFound { reserved := true  return code }
        operation reject(): string or NotFound { return NotFound { resource: code } }
        operation touch() { reserved := false }
      }
      repository Orders for Order { }
    }
  }
  api A from D
  storage pg { type: postgres }
  resource s { for: Shop, kind: state, use: pg }
  deployable d { platform: elixir, contexts: [Shop], dataSources: [s], port: 4000 }
}
`;

const ctxModule = async (src: string): Promise<string> => {
  const files = await generateSystemFiles(src);
  const hit = [...files.entries()].find(([p]) => p.endsWith("shop.ex"));
  expect(hit, "no shop.ex").toBeDefined();
  return hit![1];
};

describe("vanilla Phoenix — returning-op version bump", () => {
  it("a returning op that WRITES NOTHING gains no changeset, and so no bump", async () => {
    // Scope guard.  The bump rides the persist pipeline, so it must appear only
    // where there IS one — a returning op with no assignment (here the
    // error-variant `reject`) short-circuits before any changeset, and a fix
    // that bumped unconditionally would show up as a version write on a command
    // that never touches the row.
    //
    // (An unversioned aggregate is NOT the guard to write: `versioned` is
    // applied by default to every non-`eventLog` aggregate — `applyDefaultVersioning`
    // in `src/macros/expander.ts` — so that branch is unreachable from ordinary
    // source and asserting it would pin a shape the compiler never emits.)
    const mod = await ctxModule(versionedSrc("with crudish"));
    const reject = mod.slice(mod.indexOf("def reject_order(%D.Shop.Order{}"));
    const rejectBody = reject.slice(0, reject.indexOf("\n  end"));
    expect(rejectBody).toContain('{:error, "NotFound"');
    expect(rejectBody).not.toContain("Ecto.Changeset");
    expect(rejectBody).not.toContain("record.version + 1");
  });
});

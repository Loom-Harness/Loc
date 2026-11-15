// A BARE `toThrow()` over an operation whose only possible rejection is an
// INVARIANT.
//
// The aggregate's invariants live in the Ecto changeset; the vanilla pure op
// core checks them after a void operation's writes too (the invariant floor,
// raising `GuardError` with kind `:invariant`), so the bare form's
// `assert_raise GuardError` fires on every path: an invariant-only op, a
// guarded op, and a guard reached through a private op.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = `system T {
  subdomain S {
    context C {
      aggregate Counter {
        qty: int
        invariant qty >= 0
        create(qty: int) { qty := qty }
        operation setQty(n: int) { qty := n }
        operation bump(n: int) {
          precondition n > 0
          qty := qty + n
        }
        private operation capAt(n: int) { precondition n < 100 }
        operation viaPrivate(n: int) {
          capAt(n)
          qty := n
        }
        test "invariant-only rejection" {
          let c = Counter.create(qty: 1)
          expect(c.setQty(-1)).toThrow()
        }
        test "precondition rejection" {
          let c = Counter.create(qty: 1)
          expect(c.bump(-1)).toThrow()
        }
        test "guard reached through a private op" {
          let c = Counter.create(qty: 1)
          expect(c.viaPrivate(500)).toThrow()
        }
      }
      repository Counters for Counter { }
    }
  }
  api A from S
  storage primary { type: postgres }
  resource cs { for: C, kind: state, use: primary }
  deployable e { platform: elixir  contexts: [C]  dataSources: [cs]  serves: A  port: 4000 }
}`;

async function testFile(): Promise<string> {
  const files = await generateSystemFiles(SRC);
  const k = [...files.keys()].find((p) => p.endsWith("counter_test.exs"));
  expect(k, "counter_test.exs not emitted").toBeDefined();
  return files.get(k!)!;
}

/** The emitted ExUnit block for one named test. */
function block(src: string, name: string): string {
  const at = src.indexOf(`test "${name}" do`);
  expect(at, `no test "${name}"`).toBeGreaterThanOrEqual(0);
  return src.slice(src.lastIndexOf("\n\n", at), src.indexOf("\n  end", at));
}

describe("elixir domain test — bare toThrow() over an invariant-only op (E8)", () => {
  it("asserts the invariant rejection the pure core raises", async () => {
    const b = block(await testFile(), "invariant-only rejection");
    expect(b).not.toContain("@tag :skip");
    expect(b).toContain(
      'assert_raise E.GuardError, fn -> E.C.Counter.set_qty(c, %{"n" => -1}) end',
    );
  });

  it("keeps the assert_raise when the op carries a precondition", async () => {
    const b = block(await testFile(), "precondition rejection");
    expect(b).not.toContain("@tag :skip");
    expect(b).toContain('assert_raise E.GuardError, fn -> E.C.Counter.bump(c, %{"n" => -1}) end');
  });

  it("keeps the assert_raise when the guard is reached through a private op", async () => {
    const b = block(await testFile(), "guard reached through a private op");
    expect(b).not.toContain("@tag :skip");
    expect(b).toContain("assert_raise E.GuardError");
  });
});

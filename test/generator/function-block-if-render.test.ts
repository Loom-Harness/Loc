// A block-body `function` whose only `return`s sit inside an `if`, RENDERED on
// all five backends, from the shared corpus fixture (`domain-services.ddd`,
// `Account.tier`).
//
// The shape was unreachable until wave C2: `checkFunction`
// (`src/language/validators/types.ts`) counted TOP-LEVEL `return`s only, so
// phase ④ refused it with `loom.function-block-no-return` on every backend —
// while every backend could already render it.  That is the failure mode this
// test exists to keep closed: the validator gate and the five emitters have no
// other place where they are compared, so a re-narrowed gate would once again
// read as "the feature does not exist" rather than as a regression.
//
// WHY IT ASSERTS THE BRANCH BODIES, NOT JUST THE SIGNATURE.  A method head is
// emitted from the function's declaration alone; what was never exercised is
// the STATEMENT path — the shared `_stmt/target.ts` `if` arm on
// node/dotnet/java/python and `renderPureBlock`'s own arm on elixir.  An
// emitter that dropped the `else`, or rendered the branch as a no-op, keeps a
// perfectly good signature.  So each backend pins both branch values AND their
// order (the `gold` branch is the `if`, the `bronze` branch the `else`), and a
// vacuity guard asserts the fixture still carries the shape at all.

import { describe, expect, it } from "vitest";
import type { Backend } from "../fixtures/corpus/backends.js";
import { corpusSource, generateCorpusCase } from "../fixtures/corpus/harness.js";

/** The emitted file carrying `Account`'s domain methods, per backend, and the
 *  head of the rendered `tier` function.  Five independent observations, not
 *  one shared matcher that could be wrong the same way five times. */
const EXPECTED: Record<Backend, { file: string; head: RegExp }> = {
  node: { file: "d/domain/account.ts", head: /public tier\(threshold: number\): string \{/ },
  dotnet: {
    file: "d/Domain/Accounts/Account.cs",
    head: /public string Tier\(decimal threshold\)/,
  },
  java: {
    file: "d/src/main/java/com/loom/d/features/accounts/Account.java",
    head: /public String tier\(BigDecimal threshold\) \{/,
  },
  python: { file: "d/app/domain/account.py", head: /def tier\(self, threshold: [^)]+\) -> str:/ },
  vanilla: {
    file: "d/lib/d/accounts/account.ex",
    head: /def tier\(%__MODULE__\{\} = record, threshold\) do/,
  },
};

describe("block-body `function` with a branching tail — all five backends", () => {
  it("the fixture still carries the shape (vacuity guard)", () => {
    const src = corpusSource("domain-services");
    expect(src).toMatch(/function tier\(threshold: decimal\): string \{/);
    expect(src).toMatch(
      /if balance\.amount > threshold \{ return "gold" \} else \{ return "bronze" \}/,
    );
  });

  for (const [backend, { file, head }] of Object.entries(EXPECTED) as [
    Backend,
    { file: string; head: RegExp },
  ][]) {
    it(`${backend} renders both branches in order`, async () => {
      const files = await generateCorpusCase("domain-services", backend);
      const content = files.get(file);
      expect(content, `${file} not emitted`).toBeDefined();
      const text = content as string;
      expect(text).toMatch(head);
      const at = text.search(head);
      // The rendered function, bounded generously — long enough to hold both
      // branches on every backend, short enough that a later `"gold"` in an
      // unrelated method cannot satisfy the assertions below.
      const body = text.slice(at, at + 400);
      const gold = body.indexOf('"gold"');
      const bronze = body.indexOf('"bronze"');
      expect(gold, "the `if` branch value is missing").toBeGreaterThan(-1);
      expect(bronze, "the `else` branch value is missing").toBeGreaterThan(-1);
      expect(gold).toBeLessThan(bronze);
    });
  }
});

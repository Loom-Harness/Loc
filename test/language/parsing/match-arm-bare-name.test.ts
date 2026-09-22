// A bare-name condition in a predicate `match` did not parse, and the error
// pointed at the wrong line.
//
//     match {
//       pwOk => Badge { "ok" }
//       else => Text { "no" }
//     }
//     → Expecting token of type '=>' but found `else`.
//
// The cause is in the grammar, not the input.  `MatchArm` took
// `cond=Expression`, and `Expression` admits `Lambda` (`ID '=>' body`) at the
// top of the ladder — so `pwOk => Badge { "ok" }` was consumed WHOLE as a
// lambda, the arm's own `=>` was then missing, and the parser complained about
// the next token it could see: `else`, two lines below the real cause.
//
// `pwOk == true =>` always parsed, which is the tell — a binary expression
// cannot start a lambda, so only the bare-name form was affected. That made
// the defect look like "match needs a comparison", which is not a rule this
// language has.
//
// The fix excludes `Lambda` from an arm condition (a lambda is not a boolean),
// the same reasoning that already keeps `Lambda` out of binary operands.

import { describe, expect, it } from "vitest";
import { parseString } from "../../_helpers/parse.js";

const ui = (body: string) => `
system M {
  subdomain S { context C { aggregate T with crudish { n: string } repository Ts for T { } } }
  api CApi from S
  ui W {
    api C: CApi
    page P {
      route: "/"
      state { pwOk: bool = false  other: bool = true }
      body: ${body}
    }
  }
  storage primary { type: postgres }
  resource cs { for: C, kind: state, use: primary }
  deployable api { platform: node, contexts: [C], dataSources: [cs], serves: CApi, port: 3000 }
  deployable w { platform: react, targets: api, ui: W { C: api }, port: 3001 }
}`;

async function errorsFor(body: string): Promise<string[]> {
  const { errors } = await parseString(ui(body));
  return errors;
}

describe("a bare-name condition in a predicate match", () => {
  it("parses", async () => {
    expect(
      await errorsFor(`match {
        pwOk => Badge { "ok" }
        else => Text { "no" }
      }`),
    ).toEqual([]);
  });

  it("parses with several bare-name arms", async () => {
    expect(
      await errorsFor(`match {
        pwOk => Badge { "ok" }
        other => Badge { "other" }
        else => Text { "no" }
      }`),
    ).toEqual([]);
  });

  it("parses a bare-name arm with no else", async () => {
    expect(await errorsFor(`match { pwOk => Badge { "ok" } }`)).toEqual([]);
  });

  it("still parses a comparison condition — the form that always worked", async () => {
    expect(
      await errorsFor(`match {
        pwOk == true => Badge { "ok" }
        else => Text { "no" }
      }`),
    ).toEqual([]);
  });

  it("still parses a negated bare name", async () => {
    expect(
      await errorsFor(`match {
        !pwOk => Text { "no" }
        else => Badge { "ok" }
      }`),
    ).toEqual([]);
  });

  it("leaves a lambda alone where a lambda actually belongs", async () => {
    // The narrowing is scoped to an arm CONDITION.  A lambda in a value slot —
    // the `data:` callback here — must keep parsing, or the fix traded one
    // breakage for another.
    expect(await errorsFor(`QueryView { of: C.T.all, data: rows => Text { "n" } }`)).toEqual([]);
  });
});

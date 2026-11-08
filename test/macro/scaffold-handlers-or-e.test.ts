// `scaffoldHandlers` over an operation whose result is an expected failure
// (`T or E`): the minted commandHandler declares the operation's result and
// answers it from a terminal statement `match` — one `return` per variant — so
// the error reaches the wire at its mapped status and rolls the command back,
// as a hand-written handler of that shape does.  An operation with no `error`
// variant (or no result) keeps the bare call.  The behavioural witness is
// corpus `scaffold-handlers-or-e`.

import { readFileSync } from "node:fs";
import { AstUtils } from "langium";
import { describe, expect, it } from "vitest";
import { type CommandHandler, isCommandHandler } from "../../src/language/generated/ast.js";
import { printStructural } from "../../src/language/print/index.js";
import { lspCodes } from "../_helpers/diagnostics.js";
import { parseString } from "../_helpers/parse.js";

const SOURCE = readFileSync("test/fixtures/corpus/scaffold-handlers-or-e.ddd", "utf8").replace(
  "__PLATFORM__",
  "node",
);

const WITH_PLAIN_OPS = SOURCE.replace(
  "        operation close(): Order or Unsettled {",
  "        operation bump() { paid := paid + 1 }\n        operation tally(): int or string { return paid }\n        operation close(): Order or Unsettled {",
);

async function handler(src: string, name: string): Promise<string> {
  const { model } = await parseString(src, { validate: false });
  const h = [...AstUtils.streamAllContents(model)]
    .filter(isCommandHandler)
    .find((c) => c.name === name) as CommandHandler | undefined;
  expect(h, `no handler ${name}`).toBeDefined();
  return printStructural(h!);
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

describe("scaffoldHandlers over an operation answering `T or E`", () => {
  it("declares the result and returns every variant from its own arm", async () => {
    const settle = squash(await handler(SOURCE, "SettleOrder"));
    expect(settle).toContain("commandHandler SettleOrder(orderId: Order id): int or Unsettled");
    expect(settle).toContain("let o = OrderRepo.get(orderId)");
    expect(settle).toContain("let r = o.settle()");
    expect(settle).toContain("match r { int v => { return v } Unsettled v => { return v } }");

    const close = squash(await handler(SOURCE, "CloseOrder"));
    expect(close).toContain("commandHandler CloseOrder(orderId: Order id): Order or Unsettled");
    expect(close).toContain("match r { Order v => { return v } Unsettled v => { return v } }");
  });

  it("validates clean: the minted union result is an expected failure", async () => {
    const { diagnostics } = await parseString(SOURCE, { validate: true });
    expect(lspCodes(diagnostics)).toEqual([]);
  });

  it("keeps the bare call for an operation without an error variant", async () => {
    const bump = squash(await handler(WITH_PLAIN_OPS, "BumpOrder"));
    expect(bump).toContain("o.bump()");
    expect(bump).not.toContain("match");
    const tally = squash(await handler(WITH_PLAIN_OPS, "TallyOrder"));
    expect(tally).toContain("o.tally()");
    expect(tally).not.toContain("match");
    expect(tally).not.toContain(": int or string");
  });
});

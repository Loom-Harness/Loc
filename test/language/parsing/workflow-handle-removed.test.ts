// The workflow `handle name(…) { … }` member is gone (D-HANDLE-REMOVAL): a
// named command entry is a context-level `commandHandler`.  A source still
// using it fails to PARSE, and the one diagnostic names the replacement and
// the codemod at the `handle` itself — not chevrotain's "Expecting ':' but
// found '<name>'", which reads as a malformed state field.

import { describe, expect, it } from "vitest";
import { parseString } from "../../_helpers/parse.js";

const wrap = (members: string) => `system S {
  subdomain D {
    context C {
      aggregate Order { code: string }
      workflow Review {
${members}
      }
    }
  }
}`;

describe("a leftover workflow `handle`", () => {
  it("fails with one error at `handle`, naming commandHandler and the codemod", async () => {
    const { errors } = await parseString(
      wrap(`        st: string
        create(n: int) { st := "Filed" }
        handle approve(n: int) { st := "Approved" }`),
    );
    expect(errors).toHaveLength(1);
    // Line 8, column 9: the `handle` keyword, not the name after it.
    expect(errors[0]).toMatch(/^8:9 /);
    expect(errors[0]).toContain("workflow 'Review': 'handle approve(…)' is no longer part");
    expect(errors[0]).toContain("commandHandler approve(…)");
    expect(errors[0]).toContain("scripts/codemod-workflow-handle.mjs");
  });

  it("is the same refusal for a gated handle", async () => {
    const { errors } = await parseString(wrap(`        handle approve() requires true { }`));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("'handle approve(…)' is no longer part");
  });

  it("is the same refusal for a `private` handle, at the `handle`", async () => {
    // `private` commits the parser to a callable member, so it fails ON
    // `private` — the refusal still names the handle.
    const { errors } = await parseString(wrap(`        private handle approve() { }`));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^6:17 /);
    expect(errors[0]).toContain("'handle approve(…)' is no longer part");
  });

  it("leaves a genuinely malformed state field with chevrotain's own message", async () => {
    // `status string` (a missing `:`) is not a handle: the refusal must not
    // claim it is.
    const { errors } = await parseString(wrap(`        status string`));
    expect(errors).toHaveLength(1);
    expect(errors[0]).not.toContain("commandHandler");
  });

  it("does not fire outside a workflow body", async () => {
    // `handle` is an ordinary name now — a field called `handle` parses.
    const src = `system S { subdomain D { context C {
      aggregate Order { handle: string }
    } } }`;
    expect((await parseString(src)).errors).toEqual([]);
  });
});

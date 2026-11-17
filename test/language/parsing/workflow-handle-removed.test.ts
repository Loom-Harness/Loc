// Gate for D-HANDLE-REMOVAL (docs/decisions).
// A workflow has no `handle` member: the named command entry is a context-level
// `commandHandler`.  `handle` is an ordinary name, so a `handle name(…)` member
// in a workflow body is an ordinary parse error.

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

describe("a workflow has no `handle` member", () => {
  it("a `handle` member is a parse error", async () => {
    const { errors } = await parseString(
      wrap(`        st: string
        create(n: int) { st := "Filed" }
        handle approve(n: int) { st := "Approved" }`),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it("`handle` is an ordinary field name", async () => {
    const src = `system S { subdomain D { context C {
      aggregate Order { handle: string }
    } } }`;
    expect((await parseString(src)).errors).toEqual([]);
  });
});

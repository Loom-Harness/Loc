// Statement null-narrowing: an `if`'s block, the rest of a body after a
// `precondition` or an early-return guard. A region that can change the path
// (a write to it, or an operation call when it is aggregate state) does not
// narrow, and a `requires` does not narrow (it is checked at the route).

import { describe, expect, it } from "vitest";
import { lspCodes } from "../../_helpers/diagnostics.js";
import { parseString } from "../../_helpers/parse.js";

const sys = (members: string) => `
system Demo {
  subdomain S {
    context C {
      valueobject Addr { city: string }
      aggregate R with crudish {
        name: string
        note: string?
        addr: Addr?
        operation touch() { name := "t" }
        ${members}
      }
    }
  }
}`;

async function codes(members: string): Promise<string[]> {
  const { diagnostics } = await parseString(sys(members), { validate: true });
  return lspCodes(diagnostics);
}

const NULLABLE = "loom.nullable-receiver";

describe("statement narrowing — admitted", () => {
  it.each([
    [
      "an `if != null` block, param",
      "operation a(o: string?) { if o != null { name := o.trim() } }",
    ],
    [
      "an `if != null` block, `this.` field",
      "operation a() { if this.note != null { name := this.note.trim() } }",
    ],
    [
      "the else block of `if == null`",
      'operation a() { if note == null { name := "" } else { name := note.trim() } }',
    ],
    [
      "an else-if after `if == null`",
      'operation a() { if note == null { name := "" } else if name == "" { name := note.trim() } }',
    ],
    [
      "the rest of a body after a precondition",
      "operation a() { precondition note != null  name := note.trim() }",
    ],
    [
      "the rest of a body after an early return",
      'operation a(o: string?): string { if o == null { return "" }  return o.trim() }',
    ],
    [
      "a nested block inside the narrowed region",
      'operation a() { if note != null { if name == "" { name := note.trim() } } }',
    ],
    [
      "a param across an operation call",
      "operation a(o: string?) { if o != null { touch()  name := o.trim() } }",
    ],
  ])("%s", async (_what, op) => {
    expect(await codes(op)).toEqual([]);
  });
});

describe("statement narrowing — refused", () => {
  it.each([
    [
      "after the `if` block",
      'operation a() { if note != null { name := "x" }  name := note.trim() }',
    ],
    ["the then block of `if == null`", "operation a() { if note == null { name := note.trim() } }"],
    ["a `requires` guard", "operation a() { requires note != null  name := note.trim() }"],
    [
      "a region that writes the path",
      "operation a() { if note != null { note := null  name := note.trim() } }",
    ],
    [
      "a region that writes a prefix of the path",
      "operation a() { if addr != null { addr := null  name := addr.city } }",
    ],
    [
      "a `this.` path written by its bare name",
      "operation a() { if this.note != null { note := null  name := this.note.trim() } }",
    ],
    [
      "aggregate state across an operation call",
      "operation a() { if note != null { touch()  name := note.trim() } }",
    ],
    [
      "an `if == null` guard that does not return",
      'operation a() { if note == null { name := "" }  name := note.trim() }',
    ],
  ])("%s", async (_what, op) => {
    expect(await codes(op)).toContain(NULLABLE);
  });
});

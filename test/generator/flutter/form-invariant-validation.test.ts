// Flutter client-side invariant validation (M-T1.16, ledger row
// `M-T1.16-invariant-validation-feliz-flutter`).
//
// Before this, every `TextFormField` on a generated Loom form validated
// emptiness and number-parseability and NOTHING else: a `priority >= 1`
// violation reached the user only as a 422 from the server, while react / vue /
// svelte folded the same rule into the zod schema and Angular into
// `Validators.*`.  Silent — no `loom.*` code marked the divergence.
//
// The rules are derived through the SAME `takeSingleFieldChain` gate the zod
// and Angular paths use, and denied with the SAME `singleFieldMessage`
// sentence, so the assertions below pin cross-frontend wording rather than a
// Flutter-local invention.
//
// Compiled + RUNTIME proof (not reproducible in vitest, recorded in the packet
// hand-off): `flutter analyze` clean on this exact shape, and four
// hand-written `flutter test` widget cases driving the real `Form` — a
// too-short title denied, an out-of-range `Priority` + sub-bound `Weight` +
// bad `Email` all denied at once, a fully valid form denied by nothing, and
// six emoji accepted against a `length == 6` rule (the code-point case
// `s.length` would have failed).

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = `
system Inv {
  api A from D
  subdomain D { context C {
    aggregate Ticket {
      title: string
      code: string
      priority: int
      weight: decimal
      email: string
      plain: string
      invariant title.length >= 3 && title.length <= 40
      invariant priority >= 1
      invariant priority <= 5
      invariant code.length == 6
      invariant weight > 0.5
      invariant email.matches("^[^@]+@[^@]+$") message "Email must look like an address"
      operation reprioritize(newPriority: int) {
        precondition newPriority >= 1
        priority := newPriority
      }
    }
    repository Tickets for Ticket {}
  } }
  storage db { type: postgres }
  resource st { for: C, kind: state, use: db }
  ui App {
    framework: flutter
    api Shop: A
    page Home { route: "/"  body: Stack { Heading { "H", level: 1 }, CreateForm { of: Ticket } } }
    page Admin { route: "/tickets/:id"  body: Stack { Heading { "A", level: 1 }, OperationForm { of: Ticket, op: reprioritize } } }
  }
  deployable api1 { platform: node contexts: [C] dataSources: [st] serves: A port: 8081 }
  deployable app { platform: flutter targets: api1 ui: App { Shop: api1 } port: 3006 }
}`;

async function formsDart(): Promise<string> {
  const files = await generateSystemFiles(SRC);
  const entry = [...files.entries()].find(([k]) => k.endsWith("app/lib/forms.dart"));
  expect(entry, "no app/lib/forms.dart emitted").toBeDefined();
  return entry![1];
}

describe("flutter forms — invariant-derived client validation (M-T1.16)", () => {
  it("a length RANGE becomes one code-point guard with the shared sentence", async () => {
    const src = await formsDart();
    expect(src).toContain(
      "if (s.runes.length < 3 || s.runes.length > 40) { return 'Title must be 3 to 40 characters'; }",
    );
    // `s.length` counts UTF-16 code units in Dart; the same constraint is
    // published to the JSON Schema in CODE POINTS, so `.runes.length` is
    // load-bearing, not a style choice.
    expect(src).not.toContain("(s.length < 3");
    expect(src).not.toMatch(/[^e]s\.length/);
  });

  it("a length EQUALITY becomes a single `!=` guard", async () => {
    const src = await formsDart();
    expect(src).toContain(
      "if (s.runes.length != 6) { return 'Code must be exactly 6 characters'; }",
    );
  });

  it("numeric bounds parse first, then compare — both bounds on one field", async () => {
    const src = await formsDart();
    expect(src).toContain("final n = int.tryParse(s); if (n == null) { return 'Enter a number'; }");
    expect(src).toContain("if (n < 1) { return 'Priority must be at least 1'; }");
    expect(src).toContain("if (n > 5) { return 'Priority must be at most 5'; }");
  });

  it("an EXCLUSIVE bound on a decimal renders `<=`, not `<`", async () => {
    const src = await formsDart();
    // `weight > 0.5` is violated by `n <= 0.5`.  Rendering `n < 0.5` would
    // silently accept exactly 0.5, which the server then refuses.
    expect(src).toContain("if (n <= 0.5) { return 'Weight must be greater than 0.5'; }");
  });

  it("a regex rides a Dart RAW string, and an AUTHORED message wins", async () => {
    const src = await formsDart();
    expect(src).toContain(
      "if (!RegExp(r'^[^@]+@[^@]+$').hasMatch(s)) { return 'Email must look like an address'; }",
    );
    // Not the derived fallback — the author wrote a message.
    expect(src).not.toContain("Email is not in the expected format");
  });

  it("an operation's PRECONDITION validates its own param", async () => {
    const src = await formsDart();
    expect(src).toContain("if (n < 1) { return 'New Priority must be at least 1'; }");
  });

  it("a field with NO rule keeps the byte-identical one-liner validator", async () => {
    const src = await formsDart();
    // `plain: string` is constrained by nothing — the pre-M-T1.16 arrow form,
    // unchanged.  This is the floor that keeps the change additive.
    expect(src).toContain(
      "decoration: const InputDecoration(labelText: 'Plain'), validator: (v) => (v == null || v.trim().isEmpty) ? 'Required' : null)",
    );
  });

  it("every emitted validator closure is brace-balanced", async () => {
    const src = await formsDart();
    for (const line of src.split("\n")) {
      if (!line.includes("validator: (v) {")) continue;
      const opens = (line.match(/\{/g) ?? []).length;
      const closes = (line.match(/\}/g) ?? []).length;
      expect(opens, `unbalanced validator closure: ${line.trim()}`).toBe(closes);
    }
  });
});

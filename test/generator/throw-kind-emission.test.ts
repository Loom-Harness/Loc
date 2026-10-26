// `expect(<call>).toThrow(precondition)` / `.toThrow(invariant)` — the emitted
// assertion, pinned across all five UNIT-tier emitters in one place.
//
// WHY THE MATCHER EXISTS.  The 2026-09-13 testability audit mutation-probed the
// generated unit tier by deleting a `precondition` from a generated aggregate.
// The test stayed GREEN — the aggregate's `invariant` threw in its place, and
// `toThrow()` cannot tell the two apart, so a test named "a fresh work order
// cannot be completed" went on claiming something it no longer proved (F11).
//
// WHY ONE SHARED TEST RATHER THAN FIVE.  The claim is that all five legs pin
// the SAME rung from the same `.ddd`.  Five per-backend tests can each drift to
// a different (or absent) discriminator and stay green everywhere; asserting
// every leg in one file cannot hide that.  Same reasoning as
// `domain-denial-detail-parity.test.ts`.
//
// THE RUNG IS STRUCTURAL ON ALL FIVE.  Each backend's domain error carries the
// rung as a field — `DomainError.kind` (node, python), `DomainException.getKind()`
// (java), `DomainException.Kind` (.NET), `GuardError.kind` (elixir) — and the
// unit assertion reads that field, never the message, because an authored
// `message "..."` REPLACES the derived "Precondition failed: <src>" sentence.
// So a messaged rule is asserted exactly like a message-less one (the
// `messaged` probe below).

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

/** The audit's probe, reduced: ONE operation carrying BOTH rungs — a
 *  `precondition` and a guarded collection `invariant` that trips on the same
 *  call — so that with the precondition gone the invariant throws instead. */
const SOURCE = (platform: string, matcher: string, messaged = false) => `
system Probe {
  subdomain Ops {
    context Work {
      enum WorkStatus { Draft, InProgress, Completed }

      aggregate WorkOrder {
        reference: string
        status: WorkStatus = Draft
        contains tasks: Task[]
        entity Task { label: string }

        invariant tasks.count > 0 when status == Completed${
          messaged ? ` message "a completed work order needs at least one task"` : ""
        }

        create(reference: string, status: WorkStatus) { }

        operation complete() {
          precondition status == InProgress${messaged ? ` message "finish the work first"` : ""}
          status := Completed
        }

        test "a fresh work order cannot be completed" {
          let wo = WorkOrder.create(reference: "WO-1", status: Draft)
          expect(wo.complete()).${matcher}
        }
      }

      repository WorkOrders for WorkOrder { }
    }
  }

  api WorkApi from Ops
  storage primary { type: postgres }
  resource workState { for: Work, kind: state, use: primary }

  deployable d {
    platform: ${platform}
    contexts: [Work]
    dataSources: [workState]
    serves: WorkApi
    port: 4000
  }
}
`;

/** The emitted UNIT test file only.  Deliberately not the whole tree: the
 *  rung spellings this asserts also appear in the DOMAIN source (that is where
 *  they are thrown from), so a whole-tree `toContain` would pass without the
 *  assertion ever being emitted. */
async function unitTest(platform: string, matcher: string, messaged = false): Promise<string> {
  const files = await generateSystemFiles(SOURCE(platform, matcher, messaged));
  const hits = [...files.entries()].filter(
    ([p]) => /work[_.]?order/i.test(p) && /test/i.test(p) && !/integration/i.test(p),
  );
  expect(
    hits.map(([p]) => p),
    `no unit-test file emitted for ${platform}`,
  ).not.toHaveLength(0);
  return hits.map(([, c]) => c).join("\n");
}

/** What each backend's UNIT test must contain to have pinned the rung.  The
 *  strings are the assertion shapes, not paraphrases — if an emitter changes
 *  how it discriminates, this fails and the change gets reviewed. */
const PINS: Record<string, { precondition: string[]; invariant: string[] }> = {
  // vitest's `toThrow` cannot read a property, so the file-local helper does:
  // a `DomainError` whose `kind` is the rung, else `expect.fail` naming both.
  node: {
    precondition: [
      "if (kind !== undefined && err instanceof DomainError) {",
      "if (err.kind === kind) return;",
      'expectDomainRejection(() => { wo.complete(); }, "precondition");',
    ],
    invariant: ['expectDomainRejection(() => { wo.complete(); }, "invariant");'],
  },
  // xUnit: `Assert.Throws` returns the caught exception, so the rung is one
  // local plus `Assert.Equal` over its `Kind`.
  dotnet: {
    precondition: [
      "Assert.Throws<DomainException>",
      "Assert.Equal(DomainErrorKind.Precondition, __thrown",
    ],
    invariant: [
      "Assert.Throws<DomainException>",
      "Assert.Equal(DomainErrorKind.Invariant, __thrown",
    ],
  },
  // JUnit: same shape; the failure message is the thrown one, so a wrong rung
  // reports which rule actually refused.
  java: {
    precondition: [
      "assertThrows(DomainException.class",
      "assertEquals(DomainException.Kind.PRECONDITION, __thrown",
    ],
    invariant: [
      "assertThrows(DomainException.class",
      "assertEquals(DomainException.Kind.INVARIANT, __thrown",
    ],
  },
  python: {
    precondition: [
      "from app.domain.errors import DomainError",
      "with pytest.raises(DomainError) as rejected:",
      'assert rejected.value.kind == "precondition", str(rejected.value)',
    ],
    invariant: ['assert rejected.value.kind == "invariant", str(rejected.value)'],
  },
  elixir: {
    precondition: ["assert_raise", ".kind == :precondition"],
    // No entry: on this backend the aggregate's invariants live in the Ecto
    // changeset, which no in-memory op call reaches.  Asserted separately below.
    invariant: [],
  },
};

/** The domain-layer throw site must hand the rung to the error, or the
 *  assertion above reads `undefined` / `null`.  Pinned on the generated DOMAIN
 *  source for the four backends whose error class carries the field. */
const THROW_SITE_PINS: Record<string, { precondition: string; invariant: string }> = {
  node: { precondition: '"precondition"', invariant: '"invariant"' },
  python: { precondition: '"precondition"', invariant: '"invariant"' },
  java: {
    precondition: "DomainException.Kind.PRECONDITION",
    invariant: "DomainException.Kind.INVARIANT",
  },
  dotnet: {
    precondition: "DomainErrorKind.Precondition",
    invariant: "DomainErrorKind.Invariant",
  },
};

describe("toThrow(<kind>) — the emitted unit assertion pins the rung on all five backends", () => {
  for (const platform of ["node", "dotnet", "java", "python", "elixir"]) {
    it(`${platform}: toThrow(precondition) emits a precondition-specific assertion`, async () => {
      const out = await unitTest(platform, "toThrow(precondition)");
      for (const pin of PINS[platform]!.precondition) expect(out).toContain(pin);
    });

    it(`${platform}: a MESSAGED rule is asserted exactly like a message-less one`, async () => {
      // An authored message replaces the derived sentence, and must not cost
      // the assertion anything: the rung is read structurally.
      const plain = await unitTest(platform, "toThrow(precondition)");
      const messaged = await unitTest(platform, "toThrow(precondition)", true);
      expect(messaged).toBe(plain);
      expect(messaged).not.toContain("finish the work first");
    });

    it(`${platform}: the bare toThrow() is unchanged — the kind form is additive`, async () => {
      const out = await unitTest(platform, "toThrow()");
      // The bare form asserts only "the domain refused"; it must NOT have
      // silently acquired a rung.
      expect(out).not.toMatch(
        /, "precondition"\)|Kind\.PRECONDITION|DomainErrorKind\.|:precondition/,
      );
    });
  }

  for (const platform of ["node", "dotnet", "java", "python"]) {
    it(`${platform}: toThrow(invariant) pins the OTHER rung, not the same one`, async () => {
      const out = await unitTest(platform, "toThrow(invariant)");
      for (const pin of PINS[platform]!.invariant) expect(out).toContain(pin);
      // The point of the matcher: the two rungs must not collapse back into
      // one assertion that either would satisfy.
      expect(out).not.toMatch(
        /, "precondition"\)|Kind\.PRECONDITION|DomainErrorKind\.Precondition/,
      );
    });

    it(`${platform}: the domain layer hands the rung to the error at both throw sites`, async () => {
      const files = await generateSystemFiles(SOURCE(platform, "toThrow()", true));
      const domain = [...files.entries()]
        .filter(([p]) => /work[_.]?order/i.test(p) && !/test/i.test(p))
        .map(([, c]) => c)
        .join("\n");
      const pins = THROW_SITE_PINS[platform]!;
      // The authored text stays the MESSAGE (the HTTP `detail` reads it); the
      // rung rides right after it.
      expect(domain).toContain(`"finish the work first", ${pins.precondition}`);
      expect(domain).toContain(
        `"a completed work order needs at least one task", ${pins.invariant}`,
      );
    });
  }

  it("elixir: toThrow(invariant) over an aggregate op degrades to a REASONED skip", async () => {
    // Measured on a generated tree, not assumed: the vanilla pure op core is
    //
    //   def complete(%__MODULE__{} = record, _params) do
    //     if not (record.status == :InProgress), do: raise(D.GuardError, kind: :precondition, …)
    //
    // — preconditions and an in-memory struct update, and nothing else.  The
    // aggregate's invariants live in the Ecto changeset (`validate_invariants/1`),
    // which only the PERSISTENCE path pipes through, so an `invariant` rung has
    // no in-memory subject here.  The established seam for that is
    // `UnsupportedTestShapeError` → `@tag :skip` carrying the reason, which the
    // no-silent-skip conformance gate reads.  Emitting an assertion that could
    // only ever fail — or one that passes for the wrong reason — would be worse
    // than saying so.
    const out = await unitTest("elixir", "toThrow(invariant)");
    expect(out).toContain("@tag :skip");
    expect(out).toContain("aggregate invariants are enforced in the Ecto changeset");
  });
});

// A BARE `toThrow()` asserts a DOMAIN rejection, never "anything threw" (claims
// eval D2).  node once lowered it to vitest `.toThrow()` and python to
// `pytest.raises(Exception)`, both satisfied by a ReferenceError / NameError out
// of broken generated code: the eval's negative test passed only because codegen
// had emitted an undefined enum name.  .NET / Java / elixir already named their
// domain exception; this pins all five so none of them drifts back to catch-all.
// The runtime half (the seeded ReferenceError / NameError really failing the
// emitted test) is proven in the PR body against the generated suites.
const BARE_PINS: Record<string, { must: string[]; mustNot: string[] }> = {
  node: {
    must: [
      'import { DisallowedError, DomainError, ForbiddenError } from "./errors";',
      'function expectDomainRejection(call: () => unknown, kind?: "precondition" | "invariant"): void {',
      "if (kind === undefined && (err instanceof DisallowedError || err instanceof DomainError || err instanceof ForbiddenError)) return;",
      // A non-domain error is rethrown, so it FAILS the test with its own stack.
      "    throw err;",
      'expect.fail("expected the call to be rejected by the domain, but it returned");',
      "expectDomainRejection(() => { wo.complete(); });",
    ],
    mustNot: [".toThrow();"],
  },
  python: {
    must: [
      "from app.domain.errors import DisallowedError, DomainError, ForbiddenError",
      "with pytest.raises((DisallowedError, DomainError, ForbiddenError)):",
    ],
    mustNot: ["pytest.raises(Exception)"],
  },
  // java / .NET catch broadly and then ASSERT the domain-rejection family
  // (D17): the `when` gate's DisallowedException is a sibling of
  // DomainException, so a single-type assertion missed it.  A non-domain
  // exception still fails the test on the family check.
  dotnet: {
    must: [
      "Assert.ThrowsAny<Exception>(() => { wo.Complete(); });",
      "is DomainException or DisallowedException or ForbiddenException,",
    ],
    mustNot: ["Assert.Throws<DomainException>("],
  },
  java: {
    must: [
      "assertThrows(RuntimeException.class, () -> wo.complete());",
      "instanceof DomainException || __thrown1 instanceof DisallowedException || __thrown1 instanceof ForbiddenException,",
    ],
    mustNot: ["assertThrows(Exception.class", "assertThrows(DomainException.class, "],
  },
  elixir: { must: [".GuardError, fn ->"], mustNot: ["assert_raise RuntimeError"] },
};

describe("bare toThrow() — a domain rejection, never any error (claims D2)", () => {
  for (const platform of Object.keys(BARE_PINS)) {
    it(`${platform}: the bare form names the domain floor's refusal class(es)`, async () => {
      const out = await unitTest(platform, "toThrow()");
      for (const pin of BARE_PINS[platform]!.must) expect(out).toContain(pin);
      for (const pin of BARE_PINS[platform]!.mustNot) expect(out).not.toContain(pin);
    });
  }
});

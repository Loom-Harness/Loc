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
// WHY THE LEGS LOOK DIFFERENT.  Elixir is STRUCTURAL — `GuardError` is
// `defexception [:message, :kind]`, so the rung rides the struct.  That shape
// exists because reading the PREFIX was tried there and failed: an author's
// `message "..."` missed it and reraised into a 500.  The other four read the
// derived message prefix, shared from `src/generator/_test/throw-kind.ts`.  The
// asymmetry is the reason `loom.throw-kind-custom-message` refuses the matcher
// against a messaged rule.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

/** The audit's probe, reduced: ONE operation carrying BOTH rungs — a
 *  `precondition` and a guarded collection `invariant` that trips on the same
 *  call — so that with the precondition gone the invariant throws instead. */
const SOURCE = (platform: string, matcher: string) => `
system Probe {
  subdomain Ops {
    context Work {
      enum WorkStatus { Draft, InProgress, Completed }

      aggregate WorkOrder {
        reference: string
        status: WorkStatus = Draft
        contains tasks: Task[]
        entity Task { label: string }

        invariant tasks.count > 0 when status == Completed

        create(reference: string, status: WorkStatus) { }

        operation complete() {
          precondition status == InProgress
          status := Completed
        }

        test "a fresh work order cannot be completed" {
          let wo = WorkOrder.create({ reference: "WO-1", status: Draft })
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
 *  prefixes this asserts also appear in the DOMAIN source (that is where they
 *  are thrown from), so a whole-tree `toContain` would pass without the
 *  assertion ever being emitted. */
async function unitTest(platform: string, matcher: string): Promise<string> {
  const files = await generateSystemFiles(SOURCE(platform, matcher));
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
  // vitest takes a RegExp, anchored so it pins the prefix rather than finding
  // it anywhere in a longer sentence.
  node: {
    precondition: ["toThrow(/^Precondition failed: /)"],
    invariant: ["toThrow(/^Invariant violated: /)"],
  },
  // xUnit: `Assert.Throws` returns the caught exception, so the rung is one
  // local plus `Assert.StartsWith`.
  dotnet: {
    precondition: ["Assert.Throws<DomainException>", 'Assert.StartsWith("Precondition failed: "'],
    invariant: ["Assert.Throws<DomainException>", 'Assert.StartsWith("Invariant violated: "'],
  },
  // JUnit: same shape, plus a failure message naming what was expected — an
  // assertion that fails without saying which rung it wanted is half a test.
  java: {
    precondition: [
      "assertThrows(DomainException.class",
      '.getMessage().startsWith("Precondition failed: ")',
      "expected a precondition to reject this call",
    ],
    invariant: [
      "assertThrows(DomainException.class",
      '.getMessage().startsWith("Invariant violated: ")',
      "expected an invariant to reject this call",
    ],
  },
  // pytest's `raises(match=…)` runs `re.search`, so the pattern is anchored and
  // passed as a raw string.
  python: {
    precondition: ['pytest.raises(Exception, match=r"^Precondition failed: ")'],
    invariant: ['pytest.raises(Exception, match=r"^Invariant violated: ")'],
  },
  // Elixir is the structural one, and the reason the matcher needs no prefix
  // here: the rung is a FIELD, not a substring an authored `message` can erase.
  elixir: {
    precondition: ["assert_raise", ".kind == :precondition"],
    // No entry: on this backend the aggregate's invariants live in the Ecto
    // changeset, which no in-memory op call reaches.  Asserted separately below.
    invariant: [],
  },
};

describe("toThrow(<kind>) — the emitted unit assertion pins the rung on all five backends", () => {
  for (const platform of ["node", "dotnet", "java", "python", "elixir"]) {
    it(`${platform}: toThrow(precondition) emits a precondition-specific assertion`, async () => {
      const out = await unitTest(platform, "toThrow(precondition)");
      for (const pin of PINS[platform]!.precondition) expect(out).toContain(pin);
    });

    it(`${platform}: the bare toThrow() is unchanged — the kind form is additive`, async () => {
      const out = await unitTest(platform, "toThrow()");
      // The whole defect is that the bare form cannot tell the rungs apart, so
      // it must NOT have silently acquired a discriminator.
      expect(out).not.toContain("Precondition failed: ");
      expect(out).not.toContain("Invariant violated: ");
      expect(out).not.toContain(":precondition");
    });
  }

  for (const platform of ["node", "dotnet", "java", "python"]) {
    it(`${platform}: toThrow(invariant) pins the OTHER rung, not the same one`, async () => {
      const out = await unitTest(platform, "toThrow(invariant)");
      for (const pin of PINS[platform]!.invariant) expect(out).toContain(pin);
      // The point of the matcher: the two rungs must not collapse back into
      // one assertion that either would satisfy.
      expect(out).not.toContain("Precondition failed: ");
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
      "function expectDomainRejection(call: () => unknown): void {",
      "if (err instanceof DisallowedError || err instanceof DomainError || err instanceof ForbiddenError) return;",
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

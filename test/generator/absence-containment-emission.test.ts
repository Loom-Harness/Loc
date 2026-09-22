// `toBeNull()` / `toBeAbsent()` / `toContain()` — the emitted assertions,
// pinned across all five UNIT-tier emitters and the shared e2e renderer in one
// place.
//
// WHY ONE SHARED TEST RATHER THAN FIVE.  The claim is that all five legs lower
// the SAME `.ddd` to an assertion that asks the same question.  Five
// per-backend tests can each drift to a different (or absent) form and stay
// green everywhere; asserting every leg in one file cannot hide that.  Same
// reasoning as `throw-kind-emission.test.ts` and
// `domain-denial-detail-parity.test.ts`.
//
// WHY `toContain` IS ASSERTED ON BOTH RECEIVER KINDS.  It is ONE matcher with
// TWO lowerings, chosen by the subject's type.  Most targets spell both the
// same way (`in`, `.contains(...)`, `Contain`, and vitest dispatches at run
// time), so a single-receiver test would pass on four backends while proving
// nothing about the dispatch.  ELIXIR is the one that must branch — `in` on a
// binary raises `Protocol.UndefinedError` and `String.contains?/2` on a list
// raises `FunctionClauseError` — so the wrong branch is a CRASH in the
// generated suite, not a wrong answer.  Both kinds, every leg.
//
// WHY THE UNIT SOURCE NEVER WRITES A LIST LITERAL.  The vanilla Elixir test
// emitter refuses a `list` expression in test position (a pre-existing
// limitation, unrelated to these matchers) and skips the whole test body when
// it meets one — which would silently drop elixir out of this comparison.  The
// fixture reads `tags` without ever constructing one.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const UNIT_SOURCE = (platform: string) => `
system Probe {
  subdomain Ops {
    context Work {
      aggregate Doc with crudish {
        title: string
        estimate: int?
        tags: string[]

        test "absence and containment" {
          let d = Doc.create({ title: "Ship it" })
          expect(d.estimate).toBeNull()
          expect(d.title).toContain("Ship")
          expect(d.tags).toContain("urgent")
          expect(d.tags).not.toContain("later")
        }
      }

      repository Docs for Doc { }
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

/** The emitted UNIT test file only — not the whole tree.  A whole-tree
 *  `toContain` would find these substrings in the domain source (that is where
 *  the fields live) and pass without the assertion ever being emitted. */
async function unitTest(platform: string): Promise<string> {
  const files = await generateSystemFiles(UNIT_SOURCE(platform));
  const hits = [...files.entries()].filter(
    ([p]) => /doc/i.test(p) && /test/i.test(p) && !/integration/i.test(p),
  );
  expect(
    hits.map(([p]) => p),
    `no unit-test file emitted for ${platform}`,
  ).not.toHaveLength(0);
  return hits.map(([, c]) => c).join("\n");
}

/** The assertion SHAPES each backend must emit — not paraphrases.  If an
 *  emitter changes how it spells absence or containment, this fails and the
 *  change gets reviewed. */
const PINS: Record<string, readonly string[]> = {
  // vitest's names line up 1:1 with the DSL's, and its `toContain` dispatches
  // on the subject at run time — so node needs no per-matcher arm at all.
  node: [
    "expect(d.estimate).toBeNull();",
    'expect(d.title).toContain("Ship");',
    'expect(d.tags).toContain("urgent");',
    'expect(d.tags).not.toContain("later");',
  ],
  // AwesomeAssertions resolves both receiver kinds under one verb: `Contain` is
  // declared on GenericCollectionAssertions<T> AND on StringAssertions, so the
  // C# overload resolution performs the dispatch.
  dotnet: [
    "d.Estimate.Should().BeNull();",
    'd.Title.Should().Contain("Ship");',
    'd.Tags.Should().Contain("urgent");',
    'd.Tags.Should().NotContain("later");',
  ],
  // Java spells both lowerings `.contains(...)` — declared on Collection<E> and
  // on String — so the static type picks the method.
  java: [
    "assertNull(d.estimate());",
    'assertTrue(d.title().contains("Ship"));',
    'assertTrue(d.tags().contains("urgent"));',
    'assertFalse(d.tags().contains("later"));',
  ],
  // `is None`, not `== None`: identity cannot be intercepted by a `__eq__` on a
  // value-object subject.  `in` covers both receiver kinds — note the operand
  // order is REVERSED relative to every other matcher.
  python: [
    "assert d.estimate is None",
    'assert "Ship" in d.title',
    'assert "urgent" in d.tags',
    'assert "later" not in d.tags',
  ],
  // The one backend where the two lowerings are genuinely two different calls.
  elixir: [
    "assert is_nil(d.estimate)",
    'assert String.contains?(d.title, "Ship")',
    'assert "urgent" in d.tags',
    'refute "later" in d.tags',
  ],
};

describe("absence + containment matchers — unit tier, all five backends", () => {
  for (const [platform, pins] of Object.entries(PINS)) {
    it(`${platform} emits the absence and both containment lowerings`, async () => {
      const src = await unitTest(platform);
      for (const pin of pins) {
        expect(src, `${platform}: missing \`${pin}\``).toContain(pin);
      }
    });
  }

  it("elixir picks a DIFFERENT call per receiver kind", async () => {
    // The dispatch is the claim, so assert the negative too: a `String.contains?`
    // over the list subject (or an `in` over the string) would be a run-time
    // crash in the generated suite, and both spellings are present in this one
    // file — so only checking that each appears somewhere proves nothing.
    const src = await unitTest("elixir");
    expect(src).not.toContain("String.contains?(d.tags,");
    expect(src).not.toContain('"Ship" in d.title');
  });
});

const E2E_SOURCE = `
system Probe {
  subdomain Ops {
    context Work {
      aggregate Ticket with crudish {
        title: string
        estimate: int?
      }

      repository Tickets for Ticket { }
    }
  }

  test e2e "absence spellings" against d {
    let t = api.tickets.create({ title: "Ship it" })
    let read = api.tickets.getById(t)
    expect(read.estimate).toBeNull()
    expect(read.estimate).toBeAbsent()
    expect(read.title).toContain("Ship")
  }

  api WorkApi from Ops
  storage primary { type: postgres }
  resource workState { for: Work, kind: state, use: primary }

  deployable d {
    platform: node
    contexts: [Work]
    dataSources: [workState]
    serves: WorkApi
    port: 4000
  }
}
`;

describe("absence + containment matchers — e2e tier", () => {
  it("lowers the two absence spellings to two DIFFERENT questions", async () => {
    const files = await generateSystemFiles(E2E_SOURCE);
    const spec = [...files.entries()]
      .filter(([p]) => /\.e2e\.test\.ts$/.test(p))
      .map(([, c]) => c)
      .join("\n");
    expect(spec, "no e2e spec emitted").not.toEqual("");

    // `toBeNull()` asks about the VALUE.
    expect(spec).toContain("expect(read.estimate).toBeNull();");
    // `toBeAbsent()` asks about the KEY, so it is rewritten onto the receiver —
    // a value that has already evaluated to `undefined` cannot tell you whether
    // its key was in the body.  This is the whole reason the pair is two
    // matchers rather than one.
    expect(spec).toContain('expect("estimate" in read).toBe(false);');
    // …and it is NOT quietly rendered as a second null check.
    expect(spec).not.toContain("expect(read.estimate).toBeAbsent()");

    expect(spec).toContain('expect(read.title).toContain("Ship");');
  });
});

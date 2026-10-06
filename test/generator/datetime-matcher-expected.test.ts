// A `datetime` subject asserted against an ISO-8601 string literal —
// `expect(w.scheduledAt).toBe("2026-02-02T12:30:00Z")` — compares as the
// backend's date type on every backend's unit-test emitter.  The decision is
// `coerceMatcherExpected` in `src/generator/_test/arg-coercion.ts`; each
// backend supplies its own `datetime` leaf.
//
// Rendering the literal raw is wrong two ways: on TS/.NET/Java a date never
// equals a string (a red test, or a compile error), and on Python/Elixir a
// value wrongly STORED as the raw string would equal it — hiding the exact
// defect `vanilla-domain-tests.ddd` asserts against.  Ordering matchers and
// non-datetime subjects are deliberately untouched (pinned below).

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

const FIXTURE = `
system DtMatch {
  subdomain D {
    context Fulfilment {
      aggregate Widget with crudish {
        code: string
        scheduledAt: datetime?
        operation schedule(at: datetime) {
          scheduledAt := at
        }
        test "a datetime matcher compares as a date" {
          let w = Widget.create({ code: "W1" })
          w.schedule("2026-02-02T12:30:00Z")
          expect(w.scheduledAt).toBe("2026-02-02T12:30:00Z")
          expect(w.scheduledAt).not.toBe("2027-01-01T00:00:00Z")
          expect(w.code).toBe("W1")
        }
      }
    }
  }
  api A from D
  storage db { type: postgres }
  resource st { for: Fulfilment, kind: state, use: db }
  deployable honoApi   { platform: node   contexts: [Fulfilment] dataSources: [st] serves: A port: 3000 }
  deployable dotnetApi { platform: dotnet contexts: [Fulfilment] dataSources: [st] serves: A port: 8080 }
  deployable javaApi   { platform: java   contexts: [Fulfilment] dataSources: [st] serves: A port: 8082 }
  deployable pyApi     { platform: python contexts: [Fulfilment] dataSources: [st] serves: A port: 8083 }
  deployable exApi     { platform: elixir contexts: [Fulfilment] dataSources: [st] serves: A port: 4000 }
}
`;

function findFile(files: Map<string, string>, pattern: RegExp): string {
  for (const [k, v] of files) if (pattern.test(k)) return v;
  throw new Error(`no generated file matched ${pattern}`);
}

/** The assertion lines naming the given literal, and the `code` one. */
function lineWith(src: string, needle: string): string {
  const line = src
    .split("\n")
    .find((l) => l.includes(needle) && !/schedule\(|Schedule\(|[cC]reate\(/.test(l));
  if (!line) throw new Error(`no assertion naming ${needle} in:\n${src}`);
  return line.trim();
}
const AT = "2026-02-02T12:30:00Z";
const OTHER = "2027-01-01T00:00:00Z";

describe("a datetime matcher's ISO-8601 expected value compares as a date", () => {
  it("TS: toEqual(new Date(…)) — toBe would compare Date identity", async () => {
    const src = findFile(await generateSystemFiles(FIXTURE), /widget\.test\.ts$/i);
    expect(lineWith(src, AT)).toMatch(/\.toEqual\(new Date\("2026-02-02T12:30:00Z"\)\);$/);
    expect(lineWith(src, OTHER)).toMatch(/\.not\.toEqual\(new Date\("2027-01-01T00:00:00Z"\)\);$/);
    expect(lineWith(src, '"W1")')).toMatch(/\.toBe\("W1"\);$/);
  });

  it("Python: == datetime.fromisoformat(…)", async () => {
    const src = findFile(await generateSystemFiles(FIXTURE), /test_widget\.py$/i);
    expect(lineWith(src, AT)).toMatch(/== datetime\.fromisoformat\("2026-02-02T12:30:00Z"\)$/);
    expect(lineWith(src, OTHER)).toMatch(/^assert not \(.*== datetime\.fromisoformat\(/);
    expect(lineWith(src, '"W1"')).toMatch(/== "W1"$/);
  });

  it(".NET: Should().Be(DateTime.Parse(…))", async () => {
    const src = findFile(await generateSystemFiles(FIXTURE), /WidgetTests\.cs$/i);
    expect(lineWith(src, AT)).toMatch(/\.Should\(\)\.Be\(DateTime\.Parse\("2026-02-02T12:30:00Z"/);
    expect(lineWith(src, OTHER)).toMatch(/\.Should\(\)\.NotBe\(DateTime\.Parse\(/);
    expect(lineWith(src, '"W1"')).toMatch(/\.Should\(\)\.Be\("W1"\);$/);
  });

  it("Java: assertEquals(Instant.parse(…), …)", async () => {
    const src = findFile(await generateSystemFiles(FIXTURE), /WidgetTests\.java$/i);
    expect(lineWith(src, AT)).toMatch(/^assertEquals\(Instant\.parse\("2026-02-02T12:30:00Z"\), /);
    expect(lineWith(src, OTHER)).toMatch(/^assertNotEquals\(Instant\.parse\(/);
    expect(src).toMatch(/import java\.time\.Instant;/);
  });

  it("Elixir: DateTime.compare(…) == :eq — raises on a stored binary", async () => {
    const src = findFile(await generateSystemFiles(FIXTURE), /widget_test\.exs$/i);
    expect(lineWith(src, AT)).toMatch(
      /^assert DateTime\.compare\(w\.scheduled_at, elem\(DateTime\.from_iso8601\("2026-02-02T12:30:00Z"\), 1\)\) == :eq$/,
    );
    expect(lineWith(src, OTHER)).toMatch(/^refute DateTime\.compare\(/);
    expect(lineWith(src, '"W1"')).toMatch(/^assert w\.code == "W1"$/);
  });
});

describe("the rule stays narrow", () => {
  it("an ordering matcher over a datetime is NOT coerced", async () => {
    const src = findFile(
      await generateSystemFiles(
        FIXTURE.replace(
          `expect(w.scheduledAt).not.toBe("${OTHER}")`,
          `expect(w.scheduledAt).toBeGreaterThan("${OTHER}")`,
        ),
      ),
      /widget\.test\.ts$/i,
    );
    // `coerceMatcherExpected` does not fire (no `toEqual`).  The node ORDERING
    // matcher has its own subject-type arm (banking eval B-01, emit/tests.ts
    // `renderTypedValueMatcher`): vitest's `toBeGreaterThan` rejects a `Date`
    // subject outright, so both sides compare as epoch milliseconds.
    const line = lineWith(src, OTHER);
    expect(line).not.toContain("toEqual");
    expect(line).toMatch(
      /^expect\(\(w\.scheduledAt\)\?\.getTime\(\)\)\.toBeGreaterThan\(new Date\("2027-01-01T00:00:00Z"\)\.getTime\(\)\);$/,
    );
  });
});

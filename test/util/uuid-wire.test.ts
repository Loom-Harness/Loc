// `UUID_WIRE_PATTERN` is the one shape every backend's `{id}` validator and
// every request-side `X id` schema must agree on, so the constant itself is
// pinned here: what it matches, what it refuses, and the two embedding
// assumptions its consumers make.
//
// The cross-emitter agreement it exists to enforce is asserted in
// `test/conformance/id-path-param-shape-parity.test.ts`; this file is the
// unit-level contract of the constant those assertions rest on.

import { describe, expect, it } from "vitest";
import { UUID_WIRE_PATTERN, UUID_WIRE_REGEX_LITERAL } from "../../src/util/uuid-wire.js";

const re = new RegExp(UUID_WIRE_PATTERN);

describe("UUID_WIRE_PATTERN", () => {
  it.each([
    // Placeholder ids an author types for "a row that cannot exist".  None is
    // a valid RFC 4122 version+variant; all are ids Postgres stores and
    // compares happily, so all must reach the handler and answer 404.
    "00000000-0000-0000-0000-0000000000ff",
    "deadbeef-dead-beef-dead-beefdeadbeef",
    "ffffffff-ffff-ffff-ffff-ffffffffffff",
    "00000000-0000-0000-0000-000000000000",
    // A real v4 and a real v7 id.
    "550e8400-e29b-41d4-a716-446655440000",
    "01a0a082-7ef2-793a-a94d-821b98188345",
    // Hex is case-insensitive on the wire.
    "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF",
    "550E8400-e29b-41D4-a716-446655440000",
  ])("accepts the dashed-hex id %s", (id) => {
    expect(re.test(id)).toBe(true);
  });

  it.each([
    ["", "empty"],
    ["not-a-uuid", "not hex at all"],
    ["00000000-0000-0000-0000-00000000zzzz", "non-hex digits"],
    ["00000000-0000-0000-0000-00000000", "too short"],
    ["00000000-0000-0000-0000-0000000000fff", "too long"],
    ["00000000000000000000000000000000", "undashed"],
    ["0000000-00000-0000-0000-0000000000ff", "dashes in the wrong places"],
    ["../../etc/passwd", "a path traversal segment"],
    ["1 OR 1=1", "a sql fragment"],
  ])("refuses %s (%s)", (id) => {
    expect(re.test(id)).toBe(false);
  });

  it("is anchored — it never matches a uuid embedded in a longer segment", () => {
    // Unanchored, this is the difference between validating a path segment and
    // merely finding a uuid somewhere inside an attacker-chosen one.
    expect(re.test("x00000000-0000-0000-0000-0000000000ff")).toBe(false);
    expect(re.test("00000000-0000-0000-0000-0000000000ff/../admin")).toBe(false);
    expect(UUID_WIRE_PATTERN.startsWith("^")).toBe(true);
    expect(UUID_WIRE_PATTERN.endsWith("$")).toBe(true);
  });

  it("embeds as a TS regex literal with no escaping needed", () => {
    // `UUID_WIRE_REGEX_LITERAL` is interpolated straight into emitted
    // TypeScript, so a `/` in the pattern would silently terminate the literal
    // and emit code that does not parse.
    expect(UUID_WIRE_PATTERN).not.toContain("/");
    expect(UUID_WIRE_REGEX_LITERAL).toBe(`/${UUID_WIRE_PATTERN}/`);
    // And the literal really is the same matcher once evaluated.
    const evaluated = new RegExp(UUID_WIRE_REGEX_LITERAL.slice(1, -1));
    expect(evaluated.source).toBe(re.source);
  });

  it("embeds as a python raw-string pattern with no escaping needed", () => {
    // Emitted as `pattern=r"…"` in both the FastAPI `Path(...)` annotation and
    // the pydantic `StringConstraints(...)`; a `"` or a backslash would break
    // the raw string.
    expect(UUID_WIRE_PATTERN).not.toContain('"');
    expect(UUID_WIRE_PATTERN).not.toContain("\\");
  });
});

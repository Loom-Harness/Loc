import { describe, expect, it } from "vitest";
import { reservedFieldNameKeywords } from "../../../src/language/soft-keywords.js";
import { parseString } from "../../_helpers/parse.js";

// ---------------------------------------------------------------------------
// Audit #2864 § Papercuts — "reserved words that cannot name a field give an
// unexplained parse error".
//
// Two cases, and they are different positions, so they get different fixes:
//
//   valueobject Berth { slot: int }   → Expecting '}' but found `slot`
//   command File { name: string }     → Expecting token of type 'ID' but found `File`
//
// `slot` is a FIELD name, and its only hard position is the `component`
// element-param type — the same shape `money` (a `PrimitiveType` name) and
// `action` (an `ActionType` name) already have, both of which have been in
// `CommonSoftKeywords` and usable as field names for a long time.  So `slot`
// is promoted: "slot" is an ordinary domain word (a berth slot, a time slot).
//
// `File` is a DECLARATION name and a shipped primitive type for file upload.
// Refusing `command File` is defensible; an error that never says the word is
// reserved is not — the reader cannot tell a typo from a word Loom has taken.
// So that half gets a message, not a grammar change.
// ---------------------------------------------------------------------------

describe("`slot` is an ordinary name (#2864 § Papercuts)", () => {
  it("parses as a field name", async () => {
    const { errors } = await parseString(`
      context Berths {
        valueobject Berth { slot: int  quay: string }
      }
    `);
    expect(errors, "`slot: int` must parse — it is an ordinary domain word").toEqual([]);
  });

  it("still parses in its hard position — the component element-param type", async () => {
    // The promotion must not cost the position the keyword exists for.  A soft
    // keyword is reserved only where its own rule begins, so `slot` has to
    // keep working as a param TYPE while working as a field NAME.
    const { errors } = await parseString(`
      system Marketing {
        subdomain Site {
          context Pages {
            aggregate Article { headline: string }
          }
        }
        ui Web {
          component DetailView(heading: slot, summary: slot) {
            body: Stack {[ heading, summary ]}
          }
        }
      }
    `);
    expect(errors, "`heading: slot` must still declare an element param").toEqual([]);
  });

  it("works in every value position, not just as a field name", async () => {
    // `CommonSoftKeywords` composes into field names, param names, bare
    // expression refs, assignment targets and member access.  Promoting into
    // that set is what makes all five work at once; this pins that it did, so
    // a later narrowing to `Property` only would fail here.
    const { errors } = await parseString(`
      context Berths {
        aggregate Berth {
          slot: int
          operation reslot(slot: int) {
            precondition slot > 0
            this.slot := slot
          }
        }
      }
    `);
    expect(errors).toEqual([]);
  });
});

describe("a reserved word in a name position says it is reserved (#2864)", () => {
  it("names the word rather than the token stream", async () => {
    const { errors } = await parseString(`
      context Docs {
        command File { name: string }
      }
    `);
    expect(errors).toHaveLength(1);
    const [only] = errors;
    // The defect: Chevrotain's `Expecting token of type 'ID' but found \`File\``
    // describes the parser's expectation, never the author's mistake.
    expect(only).toContain("is a Loom keyword");
    expect(only).toContain("File");
    // …and names the remedy, which is the whole fix and is not self-evident.
    expect(only).toContain("Rename it");
    expect(only, "the old token-stream wording must be gone").not.toContain(
      "Expecting token of type",
    );
  });

  it("leaves a NON-name mismatch on Langium's wording", async () => {
    // The provider deliberately overrides only the name case: every other
    // mismatched-token message is already short, and the suite pins several of
    // them.  A keyword where a `{` was expected is an ordinary syntax error and
    // must not be relabelled "reserved".
    const { errors } = await parseString(`
      context Docs {
        aggregate Note title: string }
      }
    `);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join("\n")).not.toContain("is a Loom keyword");
  });
});

// ---------------------------------------------------------------------------
// The reserved-keyword sweep: a keyword written as a FIELD name.
//
// Agents building domains kept writing `event: string` / `route: …` / `theme:
// …` and getting `Expecting token of type '}' but found 'event'` — framed as an
// unbalanced brace, on a line that is fine.  Most such words are now soft; for
// the short hard list that is left (`reservedFieldNameKeywords()`, read off the
// grammar), the failure must say the word is a keyword, whichever way the
// parser happened to trip on it: at the word itself (the body's repetition
// exits), or one token later at the `:` (the word heads a member of its own —
// `operation: string` enters `Operation`).  And it must say so for the field
// in EITHER position, first in the body or after another field.
// ---------------------------------------------------------------------------

describe("a hard keyword as a field name says it is a keyword (reserved-keyword sweep)", () => {
  const hard = reservedFieldNameKeywords();

  it("the hard list is short, and holds none of the words the sweep softened", () => {
    expect(hard.length).toBeGreaterThan(0);
    expect(hard.length, "the sweep's whole point is that this list stays short").toBeLessThan(70);
    for (const w of ["event", "theme", "layout", "channel", "document", "node", "api", "ui"]) {
      expect(hard, `'${w}' is a domain word the sweep made soft`).not.toContain(w);
    }
  });

  for (const where of ["first", "after another field"] as const) {
    it(`every hard keyword, declared ${where}, is named as a keyword on its own line`, async () => {
      const wrong: string[] = [];
      for (const k of hard) {
        const body = where === "first" ? `${k}: string` : `title: string\n    ${k}: string`;
        const { errors } = await parseString(`context C {\n  aggregate A {\n    ${body}\n  }\n}`);
        const line = where === "first" ? 3 : 4;
        const hit = errors.find((e) => e.includes(`'${k}' is a Loom keyword`));
        if (!hit?.startsWith(`${line}:`)) wrong.push(`${k}: ${errors.join(" | ")}`);
      }
      expect(wrong).toEqual([]);
    });
  }

  it("a SOFT word used the same way still parses (the sweep, not just the message)", async () => {
    const { errors } = await parseString(`
      context Freight {
        aggregate Shipment {
          title: string
          event: string
          theme: string
          layout: string
          channel: string
          document: string
          node: string
          platform: string
          port: int
          check: int
          provenanced: bool
        }
      }
    `);
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The sweep's review.  14,948 seeded mistakes (one token deleted, or the head
// word misspelt, on every softened-keyword line of the valid corpus) were
// parsed before and after the sweep.  No error moved line, but three things
// regressed, and each is pinned here.
// ---------------------------------------------------------------------------

describe("the keyword sweep's review regressions", () => {
  it("a missing `{` before a `for:` clause is reported as the missing brace", async () => {
    // `for` is hard and followed by `:`, which is the reserved-name shape — but
    // the parser expected a `{`, and that is the whole story.
    const { errors } = await parseString(`
      context C { event Tick { at: datetime } }
      system S {
        timerSource Nightly
          for: Tick
          cron: "0 0 * * *"
        }
      }
    `);
    const all = errors.join("\n");
    expect(all).toContain("Expecting token of type '{'");
    expect(all).not.toContain("'for' is a Loom keyword");
  });

  it("a gate line missing its subject still fails — `requires` is a statement head", async () => {
    const { errors } = await parseString(`
      context C {
        aggregate A {
          n: int
          operation op() {
            requires .permissions.contains("x")
            n := 1
          }
        }
      }
    `);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("a missing name does not list soft keywords as the alternatives", async () => {
    // Every soft keyword is legal where a name is — as that name.  Listing
    // 'abstract', 'action', 'against', … as "expected" buried the real answer.
    const { errors } = await parseString(`
      system S {
        deployable {
          platform: node
        }
      }
    `);
    const all = errors.join("\n");
    expect(all).toContain("Unexpected '{'");
    for (const w of ["'abstract'", "'action'", "'against'"]) expect(all).not.toContain(w);
  });
});

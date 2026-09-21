import { describe, expect, it } from "vitest";
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

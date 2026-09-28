// A keyword found where a NAME was legal is a reserved-word problem, not an
// alternation the author was choosing from.
//
// `docs/language.md` promises soft keywords are "admitted as an ordinary
// identifier elsewhere".  Two grammar rules implement "elsewhere" and they are
// not the same set: `LooseName` (a name being DECLARED) admits five keywords
// `NameRefIdent` (a name being READ) does not.  So this parses its parameter
// and then cannot name it:
//
//     criterion InWindow(from: datetime) of A = startAt >= from
//     ...:6:56 error: Unexpected 'from'. Expected one of: '!', '-', 'retrieval', '{', '(' (+120 more).
//
// The declaration is accepted, so nothing points at the name; the failure
// lands on the USE, and the reply describes expression syntax. `to` in the
// same position works, so there is no rule to infer — the reserved set is
// discovered one name at a time.
//
// Three arms, and the middle one is the finding:
//   1. a keyword reserved EVERYWHERE, where a name was legal → reserved-name
//   2. a DECLARE-ONLY keyword (`from`, `await`, `transactional`,
//      `directoryLayout`) → the message that names the asymmetry
//   3. a closed-set alternation — where NO name was legal — keeps the
//      candidate dump, because there the author really was choosing from a set
//
// `id` is deliberately NOT in the declare-only set: `IdRef` gives it its own
// expression form, so it parses and binds to the aggregate's id instead of the
// parameter.  That is a silent wrong binding rather than a refusal, and a
// different finding (#2982) — see `soft-keywords.ts`.

import { describe, expect, it } from "vitest";
import { declareOnlySoftKeywords } from "../../../src/language/soft-keywords.js";
import { extractErrors, parseString } from "../../_helpers/parse.js";

async function errorsOf(src: string): Promise<string> {
  const { doc } = await parseString(src);
  return extractErrors(doc.diagnostics).join("\n");
}

/** A criterion body that READS the name it declares as a parameter. */
const READS_PARAM = (name: string) => `context C {
  aggregate A { startAt: datetime }
  criterion InWindow(${name}: datetime) of A = startAt >= ${name}
  repository As for A { }
}`;

describe("a keyword where a name was legal", () => {
  it("names the DECLARE-vs-READ asymmetry for a declare-only keyword", async () => {
    const e = await errorsOf(READS_PARAM("from"));
    expect(e).toContain("'from' is a Loom keyword and cannot be READ as a name");
    expect(e).toContain("accepted where a name is DECLARED");
    // The dump that sent the reader hunting for a syntax error.
    expect(e).not.toContain("Expected one of:");
  });

  it("every declare-only keyword reaches that message, not just `from`", async () => {
    // Derived from the grammar, so this covers the set as it stands rather
    // than a list restated here — if a keyword joins or leaves `LooseName`,
    // this case follows it.
    const words = declareOnlySoftKeywords();
    expect(words.length, "the derivation found no asymmetric keywords at all").toBeGreaterThan(0);
    for (const w of words) {
      const e = await errorsOf(READS_PARAM(w));
      expect(e, `declare-only keyword '${w}'`).toContain("cannot be READ as a name");
    }
  });

  it("a keyword reserved EVERYWHERE keeps the plain reserved-word message", async () => {
    // `aggregate` is not admitted in either name position, so the asymmetric
    // half would be a lie: there is no declaration of it to point back at.
    const e = await errorsOf(`context C {
      aggregate A { startAt: datetime }
      criterion InWindow(x: datetime) of A = startAt >= aggregate
      repository As for A { }
    }`);
    expect(e).toContain("'aggregate' is a Loom keyword, so it cannot be used as a name here");
    expect(e).not.toContain("cannot be READ as a name");
  });

  it("a CLOSED-SET alternation still gets the candidate list + did-you-mean", async () => {
    // The ratchet in the other direction: the reserved-word arm must not
    // swallow the case the candidate dump exists for.  No name is legal after
    // `type:`, so this stays exactly as it was.
    const e = await errorsOf(`system S { subdomain M { context C {
      aggregate A { n: string  derived display: string = n }
      repository As for A { }
    } }
    storage p { type: postgrez }  resource r { for: C, kind: state, use: p }
    deployable api { platform: node, contexts: [C], dataSources: [r], port: 3000 } }`);
    expect(e).toContain("Unexpected 'postgrez'.");
    expect(e).toContain("Did you mean 'postgres'?");
    expect(e).toContain("Expected one of:");
    expect(e).not.toContain("is a Loom keyword");
  });

  it("a KEYWORD in a closed-set position keeps the candidate list too", async () => {
    // The case the previous one cannot reach: `postgrez` lexes as an `ID`, so
    // the reserved arm exits on "not a keyword" before its name-was-legal
    // guard is consulted.  Only a real KEYWORD in a position where no name is
    // legal exercises that guard — and without it, `type: aggregate` would be
    // reported as a reserved-word problem when the author was choosing from a
    // closed set of storage types.
    const e = await errorsOf(`system S { subdomain M { context C {
      aggregate A { n: string  derived display: string = n }
      repository As for A { }
    } }
    storage p { type: aggregate }  resource r { for: C, kind: state, use: p }
    deployable api { platform: node, contexts: [C], dataSources: [r], port: 3000 } }`);
    expect(e).toContain("Unexpected 'aggregate'.");
    expect(e).toContain("'postgres'");
    expect(e).not.toContain("is a Loom keyword");
  });

  it("PUNCTUATION is never called a keyword, even though its token is one", async () => {
    // `?`, `{`, `=>` all carry a string PATTERN, so `isKeywordToken` is true
    // for them — and "'?' is a Loom keyword … rename it to '?Ref'" is nonsense.
    // Caught by `parse-error-reporting`'s punctuation case on the first full
    // run of this change; pinned here beside the arm that caused it.
    const e = await errorsOf(`context C {
      aggregate A { n: string }
      criterion Bad(x: int) of A = n == ?
      repository As for A { }
    }`);
    expect(e).toContain("Unexpected '?'");
    expect(e).not.toContain("is a Loom keyword");
  });

  it("an ordinary name in the same position is accepted (the fixture is honest)", async () => {
    // Without this, every assertion above could be passing on a fixture that
    // is broken for some unrelated reason.
    expect(await errorsOf(READS_PARAM("since"))).toEqual("");
  });
});

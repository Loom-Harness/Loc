// Reserved-field-name widening (audit #2865 finding D4) — the two halves.
//
// D4a. `deny` was minted by `PolicyReadRule` (`deny on X`) and never re-admitted
//      as an identifier anywhere, so `operation deny(...)` failed to parse while
//      its grammar sibling `allow` worked.  A plain asymmetry, not a scoping
//      decision.
//
// D4b. `of` / `allow` / `deep` / `global` / `policy` / `persistence` were soft
//      ONLY as `LooseName` (parameter / call-arg / clause names) and NOT as
//      `Property.name`, so `aggregate Claim { policy: Policy id }` — about the
//      most natural field name in an insurance domain — died with
//      `Expecting token of type '}' but found `policy``.
//
// Both halves are the same house rule: "never steal a domain word"
// (`keyword-identifier-completeness.test.ts` states it in full).  What makes
// this batch worth a dedicated file is that every one of these words ALSO heads
// its own hard syntax somewhere — `policy { … }` / `policy N(): bool`,
// `realization { persistence: … }`, `criterion X() of T`, the `local`/`deep`/
// `global` read ladder — so widening them is only safe if that hard syntax still
// parses to the SAME AST.  Langium's parser generator does not always error on a
// new ambiguity; it can silently re-associate a parse.  So each word carries two
// assertions here:
//
//   1. FIELD NAME — it is declarable as a property (first in the body AND after
//      a preceding property, the `fieldNameAfterField` shape from pairwise F4),
//      the parsed `Property.name` really is that word, and the structural
//      printer round-trips it.
//   2. HARD POSITION — a sample exercising every hard occurrence of the word
//      parses clean and matches `hard-position-ast.snapshot.json`, which was
//      CAPTURED ON PRE-CHANGE `main` and committed before the grammar was
//      touched.  That is the "same AST as before" proof; a silent
//      re-association shows up as a snapshot diff, not as a green run.
//
// Refresh the snapshot (only ever when the hard syntax itself changed, never to
// make this file pass) with:
//   LOOM_UPDATE_HARD_POS_SNAPSHOT=1 npx vitest run \
//     test/language/parsing/reserved-field-name-widening.test.ts

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Model } from "../../../src/language/generated/ast.js";
import { printStructural } from "../../../src/language/print/index.js";
import { reservedFieldNameKeywords } from "../../../src/language/soft-keywords.js";
import { parseRawResult } from "../../_helpers/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const SNAPSHOT = path.join(here, "hard-position-ast.snapshot.json");
const GRAMMAR = path.join(repoRoot, "src/language/ddd.langium");
const LEXICAL_DOC = path.join(repoRoot, "docs/language-reference/01-lexical-structure.md");

/** Comparable projection of an AST — same normalization
 *  `print-structural-roundtrip.test.ts` uses: keep `$type` + own non-`$`
 *  fields, collapse cross-references to their text, drop CST/containers. */
function norm(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.$refText === "string") return { $ref: o.$refText };
    if (typeof o.$type === "string") {
      const out: Record<string, unknown> = { $type: o.$type };
      for (const k of Object.keys(o)) if (!k.startsWith("$")) out[k] = norm(o[k]);
      return out;
    }
  }
  return v;
}

// ---------------------------------------------------------------------------
// The words. `deny` is D4a (it had NO identifier position at all); the other
// six were `LooseName`-only.  `promoted` records the verdict of the D4b
// investigation, which was run one word at a time (regenerate the parser, run
// the grammar suites, only then move on) so a failure would have been
// attributable to a single word.  All seven came back clean and joined
// `CommonSoftKeywords`, so `HELD_BACK` is empty today — the field stays because
// a LATER keyword may well not be promotable, and flipping it to `false` with a
// `note` is how that verdict gets recorded and pinned.
// ---------------------------------------------------------------------------

type Word = {
  /** The keyword under test. */
  word: string;
  /** Was it promoted to `Property.name` (field-name position)? */
  promoted: boolean;
  /** Why not, when `promoted` is false — the reason it stays `LooseName`-only. */
  note?: string;
  /** A source exercising EVERY hard-keyword position of the word. */
  hard: string;
};

/** Batch 3's context-level sample: the property modifiers (each written
 *  directly before the next field, the shape the colon guard exists for), a
 *  gated operation, an `emit`, and the `event` / `channel` / `projection`
 *  declaration heads. */
const MEMBER_SYNTAX = `context C {
  aggregate Order {
    code: string check code.length > 0
    email: string sensitive(pii) provenanced
    salary: int mask unless currentUser.id == "x"
    total: int
    operation ship() requires currentUser.id == "x" {
      emit Shipped { code: code }
    }
  }
  repository Orders for Order { }
  criterion Big() of Order = this.total > 10
  event Shipped { code: string }
  channel Ships { carries: Shipped }
  projection Revenue {
    n: int
    from Order as o
    where Big
    select n = count
  }
}
system S { user { id: string } }`;

/** Batch 3's system-level sample: `theme`, `layout`, a `ui` with an `api`
 *  binding, and a deployable's `platform:` / `ui:` clauses. */
const SYSTEM_SYNTAX = `context C {
  aggregate Order { code: string }
  repository Orders for Order { }
  command PlaceCmd { code: string }
  commandHandler place(cmd: PlaceCmd) { }
}
api OrdApi from C {
  route POST "/place" -> C.place
}
system S {
  theme { primary: "#3b82f6" }
  layout Frame {
    header { Text { "h" } }
    main
    footer { Text { "f" } }
  }
  ui Web {
    api Orders: OrdApi
    page Home {
      route: "/"
      body: Text { "hi" }
    }
  }
  deployable api { platform: node, contexts: [C], port: 3000 }
  deployable web { platform: react, targets: api, ui: Web, port: 3001 }
}`;

const WORDS: Word[] = [
  {
    word: "deny",
    promoted: true,
    // `PolicyReadRule`'s deny arm — both the bare (read) and `write` verb forms.
    hard: `context C {
  aggregate Claim { total: int }
  aggregate Payment { total: int }
  policy {
    allow deep on Claim
    deny on Payment
    deny write on Claim
  }
}`,
  },
  {
    word: "allow",
    promoted: true,
    // `PolicyReadRule`'s allow arm (both verbs) + `timerSource { overlap: allow }`.
    hard: `context C {
  aggregate Claim { total: int }
  event Tick { at: string }
  policy {
    allow local on Claim
    allow write deep on Claim
  }
}
system S {
  timerSource Nightly {
    for: Tick
    cron: "0 0 * * *"
    overlap: allow
  }
}`,
  },
  {
    word: "deep",
    promoted: true,
    // `ReadLevel` — on both the read and the write ladder.
    hard: `context C {
  aggregate Claim { total: int }
  policy {
    allow deep on Claim
    allow write deep on Claim
  }
}`,
  },
  {
    // Not in the audit's list, but `local` is `deep`/`global`'s third
    // `ReadLevel` sibling and `ReadLevel` is its ONLY hard position — so
    // promoting the other two and leaving this one reproduces exactly the
    // `allow`/`deny` asymmetry D4a is about, on a word (`local: bool`) at least
    // as likely to be a domain field as either of them.
    word: "local",
    promoted: true,
    hard: `context C {
  aggregate Claim { total: int }
  policy {
    allow local on Claim
    allow write local on Claim
  }
}`,
  },
  {
    word: "global",
    promoted: true,
    // `ReadLevel` — `global` parses on the write ladder too (it is an IR
    // validator error there, `loom.policy-write-global-invalid`, not a parse
    // error), so both forms belong in the sample.
    hard: `context C {
  aggregate Claim { total: int }
  policy {
    allow global on Claim
    allow write global on Claim
  }
}`,
  },
  {
    word: "of",
    promoted: true,
    // `criterion … of T`, `retrieval … of T` (both bodies), and the
    // system-level `tenancy by user.<claim> of <Registry>`.
    hard: `context C {
  aggregate Order { total: int  tenantId: string }
  criterion Big() of Order = this.total > 10
  criterion Small of Order = this.total < 2
  retrieval Recent() of Order = Big()
  retrieval Ranked(floor: int) of Order {
    where: this.total > floor
    sort: [total desc]
  }
}
system S {
  user { tenantId: string }
  tenancy by user.tenantId of Order
}`,
  },
  {
    word: "policy",
    promoted: true,
    // `PolicyDecl` has THREE forms sharing the `policy` head: the anonymous
    // read-ladder block, the named block, and the named boolean function (both
    // its `=` and `{ }` bodies).  All four shapes belong in the sample —
    // the head/name disambiguation is exactly what a promotion could disturb.
    hard: `context C {
  aggregate Claim { total: int }
  policy { allow deep on Claim }
  policy Named { allow local on Claim }
  policy IsBig(floor: int): bool = floor > 0
  policy IsSmall(floor: int): bool { floor < 0 }
}`,
  },
  {
    word: "persistence",
    promoted: true,
    // The `realization` sub-block on a deployable's `platform:` clause.
    hard: `system S {
  deployable Api {
    platform: node {
      persistence: memory
      directoryLayout: flat
    }
  }
}`,
  },
  // ---- Batch 2 (the freight-domain evaluation).  Same house rule, same two
  // assertions.  Each of these died with the generic
  // `Expecting token of type '}' but found \`<word>\`` — reported on the line
  // AFTER the offending field, which is what made them expensive to find.
  {
    word: "route",
    promoted: true,
    // An `api` body's explicit route, and a page's `route:` metadata entry.
    hard: `context C {
  aggregate Order { code: string }
  repository Orders for Order { }
  command PlaceCmd { code: string }
  commandHandler place(cmd: PlaceCmd) { }
}
api OrdApi from C {
  route POST "/place" -> C.place
}
ui U {
  page Detail {
    route: "/detail"
    body: Text { "hi" }
  }
}`,
  },
  {
    word: "type",
    promoted: true,
    // A `storage` block's sourceType, and a `requirement`'s artifact type.
    hard: `requirement US-001 {
  type: UserStory
  title: "A story"
}
system S {
  storage primary { type: postgres }
}`,
  },
  {
    word: "index",
    promoted: true,
    // A `resource` binding's manual performance indexes.
    hard: `context C {
  aggregate Order { code: string }
  repository Orders for Order { }
}
system S {
  storage primary { type: postgres }
  resource ordState {
    for: C
    kind: state
    use: primary
    index: [Order.code]
  }
}`,
  },
  {
    word: "user",
    promoted: true,
    // The system-wide claim shape, and the `tenancy by user.<claim>` clause
    // that reads through it.
    hard: `context C {
  aggregate Org with tenantRegistry, crudish { name: string  derived display: string = name }
  aggregate Doc with tenantOwned, crudish { title: string }
  repository Orgs for Org { }
  repository Docs for Doc { }
}
system S {
  user { id: guid  orgId: string }
  tenancy by user.orgId of Org
}`,
  },
  {
    word: "link",
    promoted: true,
    // A `menu` entry — both the page-reference and the external-URL arms.
    hard: `context C {
  aggregate Order { code: string }
  repository Orders for Order { }
}
ui U {
  page Detail {
    route: "/detail"
    body: Text { "hi" }
  }
  menu {
    section "Main" {
      link Detail
      link "Docs" -> "https://example.com"
    }
  }
}`,
  },
  // ---- Batch 3 (the reserved-keyword sweep).  Every word keyword became soft
  // unless it is on the short hard list (see the comment above
  // `CommonSoftKeywords` in `ddd.langium`).  That sweep's corpus proof is that
  // all 559 tracked `.ddd` files parse to the same AST before and after; these
  // samples pin the heaviest hard syntax among the ~150 words it softened —
  // the member modifiers that TRAIL a property (and so also sit in the lexer's
  // colon guard), the gate clause, and the declaration heads a context / system
  // body is made of.
  { word: "event", promoted: true, hard: MEMBER_SYNTAX },
  { word: "channel", promoted: true, hard: MEMBER_SYNTAX },
  { word: "check", promoted: true, hard: MEMBER_SYNTAX },
  { word: "requires", promoted: true, hard: MEMBER_SYNTAX },
  { word: "mask", promoted: true, hard: MEMBER_SYNTAX },
  { word: "provenanced", promoted: true, hard: MEMBER_SYNTAX },
  { word: "sensitive", promoted: true, hard: MEMBER_SYNTAX },
  { word: "projection", promoted: true, hard: MEMBER_SYNTAX },
  { word: "theme", promoted: true, hard: SYSTEM_SYNTAX },
  { word: "layout", promoted: true, hard: SYSTEM_SYNTAX },
  { word: "platform", promoted: true, hard: SYSTEM_SYNTAX },
  { word: "api", promoted: true, hard: SYSTEM_SYNTAX },
  { word: "ui", promoted: true, hard: SYSTEM_SYNTAX },
];

const PROMOTED = WORDS.filter((w) => w.promoted);
const HELD_BACK = WORDS.filter((w) => !w.promoted);

// ---------------------------------------------------------------------------

describe("reserved-field-name widening (audit D4)", () => {
  describe("field-name position (D4b)", () => {
    for (const { word } of PROMOTED) {
      it(`\`${word}\` is declarable as a property, first in the body and after one`, () => {
        for (const src of [
          `context C { aggregate A { ${word}: string } }`,
          `context C { aggregate A { title: string\n ${word}: string } }`,
          `context C { valueobject V { ${word}: string } }`,
          `context C { event E { ${word}: string } }`,
          `context C { payload P { title: string\n ${word}: string } }`,
        ]) {
          const res = parseRawResult(src);
          expect(
            res.parserErrors.map((e) => e.message),
            src,
          ).toEqual([]);
        }
      });

      it(`\`${word}\` parses as the property's NAME, not as some other node`, () => {
        // A clean parse is not enough: a mis-association could consume the word
        // elsewhere and leave a differently-shaped member. Assert the name.
        const model = parseRawResult(
          `context C { aggregate A { title: string\n ${word}: string } }`,
        ).value as Model;
        const names = JSON.stringify(norm(model));
        expect(names, `\`${word}\` did not land on a Property.name`).toContain(
          `{"$type":"Property","name":"${word}"`,
        );
      });

      it(`\`${word}\` as a field name round-trips through printStructural`, () => {
        const text = `context C { aggregate A { title: string\n ${word}: string } }`;
        const original = parseRawResult(text);
        expect(original.parserErrors).toEqual([]);
        const member = (original.value as Model).members[0];
        const printed = printStructural(member);
        const re = parseRawResult(printed);
        expect(re.parserErrors, `printed source must parse:\n${printed}`).toEqual([]);
        expect(norm(re.value), `printed source must round-trip:\n${printed}`).toEqual(
          norm(original.value),
        );
      });
    }

    for (const { word, note } of HELD_BACK) {
      it(`\`${word}\` stays LooseName-only — ${note}`, () => {
        // Pinned so a later promotion is a deliberate edit here, not a silent
        // side effect of an unrelated grammar change.
        const res = parseRawResult(`context C { aggregate A { title: string\n ${word}: string } }`);
        expect(
          res.parserErrors.length,
          `\`${word}\` unexpectedly became a field name`,
        ).toBeGreaterThan(0);
      });
    }
  });

  describe("LooseName position (D4a is exactly this for `deny`)", () => {
    for (const { word } of WORDS) {
      it(`\`${word}\` is usable as a parameter name`, () => {
        const src = `context C { aggregate A { title: string\n operation op(${word}: string) { } } }`;
        const res = parseRawResult(src);
        expect(
          res.parserErrors.map((e) => e.message),
          src,
        ).toEqual([]);
      });
    }

    // The audit's literal D4a repro was `operation deny()`, i.e. the word as a
    // DECLARATION name.  That position is out of reach of this fix and of the
    // house rule generally: `Operation.name` is `(ID | 'write')`, so `operation
    // state()` / `operation money()` fail identically — every soft keyword
    // does, not just `deny`.  Declaration names (`operation` / `create` /
    // `function` / `criterion` / …) are all bare `ID` and are NOT among the
    // seven identifier positions `keyword-identifier-completeness.test.ts`
    // enumerates.  Pinned here so the boundary is recorded rather than
    // rediscovered, and so widening it later is a deliberate edit.
    it("a keyword is still NOT admissible as an `operation` NAME — for any keyword, not just `deny`", () => {
      for (const w of ["deny", "allow", "policy", "state", "money", "kind"]) {
        const res = parseRawResult(
          `context C { aggregate A { title: string\n operation ${w}(x: string) { } } }`,
        );
        expect(res.parserErrors.length, `operation ${w}() unexpectedly parses`).toBeGreaterThan(0);
      }
    });
  });

  // The per-word samples above test each use in isolation.  The case that
  // actually decides whether a promotion is safe is the word used BOTH ways in
  // ONE document — that is where a mis-widened keyword re-associates (the
  // aggregate's `policy:` field swallowing the context's `policy { … }` block,
  // or vice versa).  Each source below declares the word as a field AND
  // exercises its hard syntax, and asserts both nodes survive.
  describe("both uses coexist in one document", () => {
    const COEXIST: { word: string; src: string; expect: string[] }[] = [
      {
        word: "policy",
        src: `context C {
  aggregate Claim { title: string  policy: string }
  policy { allow deep on Claim }
  policy IsBig(floor: int): bool = floor > 0
}`,
        expect: [`{"$type":"Property","name":"policy"`, `{"$type":"PolicyDecl"`],
      },
      {
        word: "of",
        src: `context C {
  aggregate Claim { title: string  of: string }
  criterion Named() of Claim = this.of == "x"
}`,
        expect: [`{"$type":"Property","name":"of"`, `{"$type":"Criterion"`],
      },
      {
        word: "persistence",
        src: `context C { aggregate Claim { title: string  persistence: string } }
system S {
  deployable Api { platform: node { persistence: memory } }
}`,
        expect: [`{"$type":"Property","name":"persistence"`, `"persistence":"memory"`],
      },
      {
        word: "allow / deny / local / deep / global",
        src: `context C {
  aggregate Claim { title: string  allow: bool  deny: bool  local: bool  deep: int  global: bool }
  policy {
    allow local on Claim
    allow deep on Claim
    allow global on Claim
    deny on Claim
  }
}`,
        expect: [
          `{"$type":"Property","name":"allow"`,
          `{"$type":"Property","name":"deny"`,
          `{"$type":"Property","name":"local"`,
          `{"$type":"Property","name":"deep"`,
          `{"$type":"Property","name":"global"`,
          `"effect":"deny"`,
          `"level":"local"`,
          `"level":"global"`,
        ],
      },
    ];

    for (const { word, src, expect: needles } of COEXIST) {
      it(`\`${word}\` as a field name does not disturb its hard syntax in the same file`, () => {
        const res = parseRawResult(src);
        expect(
          res.parserErrors.map((e) => e.message),
          src,
        ).toEqual([]);
        const json = JSON.stringify(norm(res.value));
        for (const needle of needles) expect(json, `missing ${needle}`).toContain(needle);
      });
    }
  });

  describe("hard-keyword positions parse to the pre-change AST", () => {
    const live: Record<string, unknown> = {};
    for (const { word, hard } of WORDS) {
      const res = parseRawResult(hard);
      it(`\`${word}\`'s hard position(s) still parse`, () => {
        expect(
          res.parserErrors.map((e) => e.message),
          hard,
        ).toEqual([]);
      });
      live[word] = norm(res.value);
    }

    it("every hard-position AST matches the snapshot captured before the widening", () => {
      if (process.env.LOOM_UPDATE_HARD_POS_SNAPSHOT === "1" || !existsSync(SNAPSHOT)) {
        writeFileSync(SNAPSHOT, `${JSON.stringify(live, null, 2)}\n`);
      }
      const expected = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
      expect(
        live,
        "A hard-keyword position now parses to a DIFFERENT AST than it did before these words were widened — the promotion re-associated the parse. Revert the offending word to LooseName-only rather than refreshing this snapshot.",
      ).toEqual(expected);
    });
  });

  // The reference doc spells the shared soft set out word by word, and that
  // prose is what a user reads before picking a field name — so it is part of
  // the contract, not decoration.  It had already drifted (`key` was promoted
  // to `CommonSoftKeywords` and the doc never picked it up), which is exactly
  // the failure this pins: re-derive the set from the grammar and compare.
  it("the lexical-structure doc lists exactly the grammar's CommonSoftKeywords", () => {
    const grammar = readFileSync(GRAMMAR, "utf8");
    const rule = /CommonSoftKeywords returns string:\n([\s\S]*?);\n/.exec(grammar);
    expect(rule, "CommonSoftKeywords rule not found in the grammar").not.toBeNull();
    const fromGrammar = [
      ...new Set([...(rule?.[1] ?? "").matchAll(/'([A-Za-z_][A-Za-z0-9_]*)'/g)].map((m) => m[1])),
    ].sort();

    const doc = readFileSync(LEXICAL_DOC, "utf8");
    const line = /The `CommonSoftKeywords` set today \([^)]*\): ([^.]*)\./.exec(doc);
    expect(line, "the doc's CommonSoftKeywords sentence was not found").not.toBeNull();
    const fromDoc = [...(line?.[1] ?? "").matchAll(/`([A-Za-z_][A-Za-z0-9_]*)`/g)]
      .map((m) => m[1])
      .sort();

    expect(
      fromDoc,
      "docs/language-reference/01-lexical-structure.md no longer lists the grammar's CommonSoftKeywords — update the sentence, it is what users read before naming a field",
    ).toEqual(fromGrammar);
  });

  it("the lexical-structure doc lists exactly the words that are NOT field names", () => {
    // The other half of the sentence above, and the one a user needs more: the
    // reserved-keyword sweep made every word keyword soft by default, so what
    // is worth writing down is the short list that is left.  A keyword that
    // becomes hard (a new one, or one moved out of `CommonSoftKeywords`) fails
    // here until the doc says so — the review of that line is the checkpoint
    // where "does this really have to steal a domain word?" gets asked.
    const doc = readFileSync(LEXICAL_DOC, "utf8");
    const line = /The words that are \*\*not\*\* field names today: ([^.]*)\./.exec(doc);
    expect(line, "the doc's hard-list sentence was not found").not.toBeNull();
    const fromDoc = [...(line?.[1] ?? "").matchAll(/`([A-Za-z_][A-Za-z0-9_]*)`/g)]
      .map((m) => m[1] as string)
      .sort((a, b) => a.localeCompare(b));
    expect(
      fromDoc,
      "docs/language-reference/01-lexical-structure.md no longer lists the grammar's hard field-name keywords",
    ).toEqual([...reservedFieldNameKeywords()]);
  });
});

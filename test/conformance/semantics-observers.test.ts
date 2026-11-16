import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ciRunProblem, ciText, readRepo } from "../_helpers/gate-paths.js";
import { fenceProblem } from "../_helpers/live-fences.js";
import { BEHAVIOURAL_XFAIL } from "../behavioral/registers.mjs";
import {
  BACKENDS,
  type Backend,
  type FactClass,
  type Observable,
  OBSERVABLES,
  SEMANTICS_RULES,
  type SemanticsRule,
} from "./semantics-rules.js";

// A conformance rule is only as strong as what its gates observe.  Each rule
// names its observables (a closed set) and its gates; this file checks that
// the gates run, that the rule's text asserts nothing its observables cannot
// see, that no backend is listed as conforming while its leg carries an
// expected failure tagged with the rule, and that the prose's `Conforms.`
// lines say what the registry says.

/** The phrases that mark a class of fact, and the observables that can see
 *  it.  A tripwire, not a parser: a reviewer adds a phrase when a spelling
 *  slips past. */
const FACT_CLASSES: Readonly<
  Record<FactClass, { readonly phrases: readonly RegExp[]; readonly seenBy: readonly Observable[] }>
> = {
  storage: {
    phrases: [
      /\bstored (inline|as)\b/i,
      /\bin storage\b/i,
      /\bstorage (round-trip|scale|layout)\b/i,
      /\bjsonb (blob|column)\b/i,
      /\bmapped column\b/i,
      /\bpersists [a-z]+_[a-z_]+\b/,
      /\bNUMERIC\(/,
    ],
    seenBy: ["persisted-row", "schema"],
  },
  transaction: {
    phrases: [/\btransactions?\b/i, /\batomic(ally)?\b/i, /\brolls? back\b/i, /\brollback\b/i],
    seenBy: ["persisted-row"],
  },
  load: {
    phrases: [/\bon load\b/i, /\brehydrat\w*/i, /\bloading\b/i],
    seenBy: ["persisted-row"],
  },
};

/** The behavioural legs, by the backend each one runs. */
const LEG_BACKEND: Readonly<Record<string, Backend>> = {
  node: "node",
  mikroorm: "node",
  dotnet: "dotnet",
  dapper: "dotnet",
  java: "java",
  python: "python",
  elixir: "elixir",
};

/** The first phrase of each fact class the rule's title or observable text
 *  matches. */
function claimedFacts(rule: Pick<SemanticsRule, "title" | "observable">): Map<FactClass, string> {
  const text = `${rule.title}\n${rule.observable}`;
  const out = new Map<FactClass, string>();
  for (const [cls, { phrases }] of Object.entries(FACT_CLASSES) as [FactClass, (typeof FACT_CLASSES)[FactClass]][]) {
    for (const p of phrases) {
      const m = p.exec(text);
      if (m) {
        out.set(cls, m[0]);
        break;
      }
    }
  }
  return out;
}

/** Why a rule's text claims more than its observables see (empty when it does
 *  not). */
function overclaims(rule: SemanticsRule): string[] {
  const problems: string[] = [];
  const declared = rule.unobserved?.classes;
  for (const [cls, phrase] of claimedFacts(rule)) {
    const seen = FACT_CLASSES[cls].seenBy.some((o) => rule.observedBy.includes(o));
    if (seen || declared === "all" || declared?.includes(cls)) continue;
    problems.push(
      `${rule.id}: "${phrase}" asserts a ${cls} fact, which only ${FACT_CLASSES[cls].seenBy.join(" or ")} ` +
        `can see, and the rule is observed by ${rule.observedBy.join(", ") || "nothing"}.  Either reword ` +
        `the title/observable to what the gates observe, or add a gate that observes ${cls} ` +
        `(and list its observable in \`observedBy\`).  A gate not built yet is declared as ` +
        `\`unobserved: { classes: ["${cls}"], tracked: "#N" }\` with a live-fence issue.`,
    );
  }
  if (Array.isArray(declared)) {
    for (const cls of declared) {
      const phrase = claimedFacts(rule).get(cls);
      const seen = FACT_CLASSES[cls].seenBy.some((o) => rule.observedBy.includes(o));
      if (!phrase || seen)
        problems.push(
          `${rule.id}: \`unobserved\` lists ${cls}, but ${phrase ? "an observer now sees it" : "the text no longer claims it"} — delete it`,
        );
    }
  }
  return problems;
}

/** The backends each rule is broken on, from the expected-failure rows that
 *  name it. */
function xfailBackends(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [leg, rows] of Object.entries(BEHAVIOURAL_XFAIL as Record<string, Record<string, { rules?: string[]; issue: string }>>)) {
    for (const [fixture, row] of Object.entries(rows)) {
      for (const id of row.rules ?? []) {
        const set = out.get(id) ?? new Set<string>();
        set.add(`${LEG_BACKEND[leg] ?? leg} (${leg}/${fixture}, ${row.issue})`);
        out.set(id, set);
      }
    }
  }
  return out;
}

/** The backends a `- **Conforms.**` bullet lists as conforming, and the ones
 *  it lists as targets (after `Target(s):` or `Residual:`). */
function proseConforms(bullet: string): { conforms: Set<string>; targets: Set<string> } {
  const names = (s: string) => new Set(BACKENDS.filter((b) => new RegExp(`\\b${b}\\b`).test(s)));
  const body = bullet.replace(/^- \*\*Conforms\.\*\*\s*/, "").replace(/\([^)]*\)/g, "");
  const split = /\*{0,2}(?:Targets?|Residual):\*{0,2}/i.exec(body);
  const head = split ? body.slice(0, split.index) : body;
  const lead = head.split(/[.;—(]/)[0] ?? "";
  const tail = split ? (body.slice(split.index + split[0].length).split(/[.;(—]/)[0] ?? "") : "";
  return { conforms: names(lead), targets: names(tail) };
}

function proseBullets(): Map<string, string> {
  const doc = readFileSync("docs/conformance-semantics.md", "utf8");
  const out = new Map<string, string>();
  const sections = doc.split(/^(?=### RS-\d+ · )/m);
  for (const sec of sections) {
    const id = /^### (RS-\d+) · /.exec(sec)?.[1];
    if (!id) continue;
    const m = /^- \*\*Conforms\.\*\*[\s\S]*?(?=\n\n|\n- \*\*|\n#)/m.exec(sec);
    if (m) out.set(id, m[0].replace(/\s+/g, " "));
  }
  return out;
}

describe("every conformance rule names what observes it", () => {
  const ci = ciText();

  it("observables are drawn from the closed set, and a rule with no gate is tracked", () => {
    const bad: string[] = [];
    for (const r of SEMANTICS_RULES) {
      for (const o of r.observedBy)
        if (!(OBSERVABLES as readonly string[]).includes(o)) bad.push(`${r.id}: unknown observable ${o}`);
      if (r.gates.length === 0 && r.unobserved?.classes !== "all")
        bad.push(`${r.id}: no gate observes it — name one, or declare \`unobserved: { classes: "all", tracked: "#N" }\``);
      if (r.gates.length > 0 && r.observedBy.length === 0) bad.push(`${r.id}: gates but no observable`);
      if (r.unobserved?.classes === "all" && r.gates.length > 0)
        bad.push(`${r.id}: \`unobserved: all\` but it names gates`);
      if (r.unobserved) {
        const p = fenceProblem(r.unobserved.tracked);
        if (p) bad.push(`${r.id}: ${p}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("every gate exists and runs in CI", () => {
    const bad: string[] = [];
    for (const r of SEMANTICS_RULES) {
      for (const g of r.gates) {
        const src = readRepo(g);
        if (src === undefined) {
          bad.push(`${r.id}: ${g} does not exist`);
          continue;
        }
        const p = ciRunProblem(g, src, ci);
        if (p) bad.push(`${r.id}: ${g} ${p}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("a rule asserts no fact its observables cannot see", () => {
    expect(SEMANTICS_RULES.flatMap(overclaims)).toEqual([]);
  });

  it("no backend conforms to a rule its own leg is an expected failure of", () => {
    const broken = xfailBackends();
    const ids = new Set(SEMANTICS_RULES.map((r) => r.id));
    const bad: string[] = [...broken.keys()]
      .filter((id) => !ids.has(id as SemanticsRule["id"]))
      .map((id) => `an expected-failure row names ${id}, which is not a rule`);
    for (const r of SEMANTICS_RULES) {
      for (const hit of broken.get(r.id) ?? []) {
        const backend = hit.split(" ")[0] as Backend;
        if (r.conforms.includes(backend))
          bad.push(
            `${r.id} lists ${backend} in \`conforms\`, but ${hit} is an expected failure of it — move ${backend} to \`targets\` until the row is deleted`,
          );
      }
    }
    expect(bad).toEqual([]);
  });

  it("the prose's Conforms line lists the registry's backends", () => {
    const bullets = proseBullets();
    const bad: string[] = [];
    for (const r of SEMANTICS_RULES) {
      const b = bullets.get(r.id);
      if (!b) {
        bad.push(`${r.id}: no \`- **Conforms.**\` line in docs/conformance-semantics.md`);
        continue;
      }
      const { conforms, targets } = proseConforms(b);
      const want = [...r.conforms].sort().join(", ");
      const got = [...conforms].sort().join(", ");
      if (want !== got) bad.push(`${r.id}: prose conforms [${got}] ≠ registry [${want}]`);
      const wantT = [...(r.targets ?? [])].sort().join(", ");
      const gotT = [...targets].sort().join(", ");
      if (wantT !== gotT) bad.push(`${r.id}: prose targets [${gotT}] ≠ registry [${wantT}]`);
    }
    expect(bad).toEqual([]);
  });
});

describe("the fact-class tripwire", () => {
  const rule = (over: Partial<SemanticsRule>): SemanticsRule => ({
    id: "RS-0" as SemanticsRule["id"],
    title: "t",
    trigger: "t",
    observable: "o",
    conforms: ["node"],
    provenance: [],
    tier: "behavioral",
    observedBy: ["wire"],
    gates: ["x"],
    ...over,
  });

  it("refuses a storage claim observed only on the wire, naming the phrase and both fixes", () => {
    const [p] = overclaims(rule({ observable: "value objects are stored inline as jsonb" }));
    expect(p).toContain('"stored inline" asserts a storage fact');
    expect(p).toContain("reword");
    expect(p).toContain("add a gate that observes storage");
  });

  it("accepts the claim once an observer that sees it is named, or the gap is tracked", () => {
    const text = { observable: "value objects are stored inline as jsonb" };
    expect(overclaims(rule({ ...text, observedBy: ["wire", "schema"] }))).toEqual([]);
    expect(overclaims(rule({ ...text, unobserved: { classes: ["storage"], tracked: "#1" } }))).toEqual([]);
  });

  it("refuses a stale `unobserved` entry", () => {
    expect(overclaims(rule({ unobserved: { classes: ["storage"], tracked: "#1" } }))[0]).toContain(
      "no longer claims it",
    );
  });

  it("reads a prose Conforms line with targets and trailing notes", () => {
    expect(
      proseConforms("- **Conforms.** node, dotnet, java, elixir. **Targets:** python."),
    ).toEqual({ conforms: new Set(["node", "dotnet", "java", "elixir"]), targets: new Set(["python"]) });
    expect(
      proseConforms("- **Conforms.** node, dotnet, java, python. **Residual:** elixir."),
    ).toEqual({ conforms: new Set(["node", "dotnet", "java", "python"]), targets: new Set(["elixir"]) });
  });
});

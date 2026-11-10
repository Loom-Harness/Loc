/**
 * Axis census: every aggregate-level modifier the language offers is a value
 * on a pairwise axis, or carries a dated waiver.
 *
 * Why it exists.  Intersection defects (a feature that validates clean and then
 * fails to compile, 500s or leaks when combined with another) were found by
 * audits after the feature merged, because a feature was "done" once it worked
 * on its own.  The pairwise cover (`axes.ts`) crosses every axis value with
 * every other one on all five backends, so a modifier ON an axis is checked in
 * combination by default.  This census makes being on an axis the default for
 * a new modifier: adding one to the prelude or the aggregate header fails here
 * until it is an axis value or a waiver says why not, and until when.
 *
 * The modifier inventory is read from its sources of truth — the prelude
 * capability map and the `ddd.langium` aggregate header — never from a list
 * kept by hand, so the census cannot drift from the language.
 *
 * Waiver discipline matches `test/system/ir-walk-census.test.ts`: a waiver is
 * parked work with a `reviewUntil` date, fails once the date passes or when it
 * is parked more than MAX_DEFERRAL_DAYS out, and fails as stale once its
 * modifier is covered or no longer exists.
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { builtinCapabilities } from "../../src/macros/prelude.js";
import { CAPABILITIES, INHERITANCE, SHAPES } from "./axes.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const grammar = readFileSync(path.join(here, "../../src/language/ddd.langium"), "utf8");

/** One aggregate-level modifier, named by where it comes from. */
interface Modifier {
  /** e.g. `capability auditable`, `header crossTenant`, `shape document`. */
  readonly id: string;
  /** The axis value that covers it, or undefined when no axis does. */
  readonly coveredBy: string | undefined;
}

/** Values of a `Rule returns string: 'a' | 'b';` data-type rule. */
function enumRuleValues(rule: string): string[] {
  const m = new RegExp(`^${rule} returns string:\\s*([^;]+);`, "m").exec(grammar);
  if (!m) throw new Error(`ddd.langium has no data-type rule \`${rule}\``);
  return [...m[1].matchAll(/'([^']+)'/g)].map((v) => v[1]);
}

/** The boolean flags of the `Aggregate` rule's header (`x?='x'`). */
function aggregateHeaderFlags(): string[] {
  const start = grammar.search(/^Aggregate:/m);
  if (start < 0) throw new Error("ddd.langium has no `Aggregate:` rule");
  const header = grammar.slice(start, grammar.indexOf("withClause=", start));
  return [...header.matchAll(/(\w+)\?='(\w+)'/g)].map((f) => f[2]).filter((f) => f !== "abstract");
}

const has = (axis: readonly string[], v: string) => (axis.includes(v) ? v : undefined);

/**
 * Grammar spellings that name an axis value differently.  `state` is the
 * default truth kind, whose saved shape the `shape` axis already enumerates.
 */
const TRUTH_KIND_AXIS: Record<string, string> = { state: "relational", eventLog: "eventLog" };
const LAYOUT_AXIS: Record<string, string> = { sharedTable: "tph", ownTable: "tpc" };

function modifierInventory(): Modifier[] {
  return [
    ...[...builtinCapabilities().keys()].map((c) => ({
      id: `capability ${c}`,
      coveredBy: has(CAPABILITIES, c),
    })),
    ...aggregateHeaderFlags().map((f) => ({ id: `header ${f}`, coveredBy: has(CAPABILITIES, f) })),
    ...enumRuleValues("SavingShape").map((s) => ({ id: `shape ${s}`, coveredBy: has(SHAPES, s) })),
    ...enumRuleValues("TruthKind").map((t) => ({
      id: `persistedAs ${t}`,
      coveredBy: TRUTH_KIND_AXIS[t] && has(SHAPES, TRUTH_KIND_AXIS[t]),
    })),
    ...enumRuleValues("InheritanceLayout").map((l) => ({
      id: `inheritanceUsing ${l}`,
      coveredBy: LAYOUT_AXIS[l] && has(INHERITANCE, LAYOUT_AXIS[l]),
    })),
  ];
}

interface Waiver {
  readonly deferred: string;
  readonly reviewUntil: string;
  readonly issue: string;
}

/** A deferral may not be parked further out than this. */
const MAX_DEFERRAL_DAYS = 180;

/**
 * Modifiers the cover does not cross yet.  Each is parked work: delete the
 * entry in the PR that adds the modifier to `axes.ts`.
 */
const WAIVERS: Record<string, Waiver> = {
  "capability auditable": {
    deferred:
      "the `auditable` mixin (managed createdAt/updatedAt/createdBy/updatedBy) is not an axis value; `audited` (the audit-trail flag) is",
    reviewUntil: "2027-02-28",
    issue: "#5119",
  },
  "capability tenantRegistry": {
    deferred: "needs a `tenancy by` system in the composed source before it can be crossed",
    reviewUntil: "2027-02-28",
    issue: "#5119",
  },
  "capability shareable": {
    deferred:
      "needs a `tenancy by` system and a `tenantOwned` host in the composed source before it can be crossed; its runtime is gated by the booted `assertShareable` tenancy-e2e leg",
    reviewUntil: "2027-02-28",
    issue: "#5119",
  },
  "header crossTenant": {
    deferred: "needs a `tenancy by` system in the composed source before it can be crossed",
    reviewUntil: "2027-02-28",
    issue: "#5119",
  },
};

const DAY_MS = 86_400_000;

describe("pairwise axis census — every aggregate-level modifier is crossed", () => {
  const inventory = modifierInventory();

  it("reads a non-trivial inventory from the language sources", () => {
    // Guards the extraction itself: a regex that stopped matching would make
    // every check below pass on an empty list.
    const ids = inventory.map((m) => m.id);
    expect(ids).toContain("capability versioned");
    expect(ids).toContain("header audited");
    expect(ids).toContain("shape document");
    expect(ids).toContain("persistedAs eventLog");
    expect(ids).toContain("inheritanceUsing ownTable");
  });

  it("puts every modifier on an axis or under a waiver", () => {
    const uncovered = inventory
      .filter((m) => m.coveredBy === undefined && !(m.id in WAIVERS))
      .map(
        (m) =>
          `${m.id}: not a value on any axis in test/pairwise/axes.ts.  Add it to the axis ` +
          `(and compose.ts) so the cover crosses it with every other feature, or add a ` +
          `dated waiver here naming the issue that will.`,
      );
    expect(uncovered, uncovered.join("\n")).toEqual([]);
  });

  it("holds no stale waiver", () => {
    const byId = new Map(inventory.map((m) => [m.id, m]));
    const stale = Object.keys(WAIVERS).flatMap((id) => {
      const m = byId.get(id);
      if (!m) return [`${id}: waived, but the language no longer offers it — delete the waiver`];
      if (m.coveredBy !== undefined)
        return [
          `${id}: waived, but axis value \`${m.coveredBy}\` now covers it — delete the waiver`,
        ];
      return [];
    });
    expect(stale, stale.join("\n")).toEqual([]);
  });

  it("holds no expired or open-ended waiver", () => {
    const now = Date.now();
    const bad = Object.entries(WAIVERS).flatMap(([id, w]) => {
      const until = Date.parse(`${w.reviewUntil}T23:59:59Z`);
      if (Number.isNaN(until)) return [`${id}: reviewUntil "${w.reviewUntil}" is not a date`];
      if (until < now) return [`${id}: deferral expired on ${w.reviewUntil} (${w.issue})`];
      if (until - now > MAX_DEFERRAL_DAYS * DAY_MS)
        return [`${id}: reviewUntil ${w.reviewUntil} is more than ${MAX_DEFERRAL_DAYS} days out`];
      if (!/^#\d+$/.test(w.issue)) return [`${id}: issue "${w.issue}" is not an issue reference`];
      return [];
    });
    expect(bad, bad.join("\n")).toEqual([]);
  });
});

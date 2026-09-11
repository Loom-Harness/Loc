// M-T3.18 (audit #2864 G3) — a `mask unless` field must not be an accepted
// `?sort=` key on ANY backend.
//
// `mask unless <expr>` (authorization.md §5) redacts a field at the wire
// boundary for a caller the predicate rejects.  The paged list read is a second
// disclosure channel the redaction does not cover: `?sort=salary&dir=asc`
// orders the page BY the hidden column, so a caller who can never read the
// value can still binary-search it out of the row order through pagination.
// The read-mask is per-caller and the whitelist is emitted once, so the only
// sound whitelist is one a masked field never enters.
//
// Every backend derives its whitelist from one helper (`sortableFields`,
// src/ir/util/sortable-fields.ts), so a single-point fix is possible — but the
// leak is per-BACKEND-EMISSION, and the emitted shapes diverge (a zod enum, a
// C# `switch`, an Ecto `case`, a `List.of(...).contains`, a Python dict).  This
// test therefore reads what each backend actually WROTE, not what the helper
// returned: a backend that stops calling the helper and re-derives its own list
// fails here while a helper-level unit test stays green.
//
// The negative half alone would pass vacuously on an EMPTY whitelist, so each
// row also asserts the unmasked siblings survived.
//
// Fast suite: no docker, no LOOM_* env — pure in-memory generation.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

const BACKENDS = ["node", "dotnet", "java", "python", "elixir"] as const;
type Backend = (typeof BACKENDS)[number];

/** Two masked fields and two unmasked scalar siblings on one aggregate, with a
 *  paged list read (`with crudish` supplies the `all` route every backend's
 *  sort whitelist is emitted for). */
const maskedSortDdd = (platform: Backend): string => `
system MaskedSort {
  user { id: string  role: string }
  subdomain People {
    context Staff {
      aggregate Employee with crudish {
        name: string
        grade: int = 1
        salary: decimal mask unless currentUser.role == "admin"
        nationalId: string mask unless currentUser.role == "admin"
      }
      repository Employees for Employee { }
    }
  }
  api StaffApi from People
  storage pg { type: postgres }
  resource staffState { for: Staff, kind: state, use: pg }
  deployable d {
    platform: ${platform}
    contexts: [Staff]
    dataSources: [staffState]
    serves: StaffApi
    port: 4000
    auth: required
  }
}`;

/** The emitted sort whitelist, per backend, as it appears in the generated
 *  source.  Each pattern captures the region that ENUMERATES the accepted
 *  keys — the thing a masked field must be absent from — rather than any line
 *  that merely mentions `sort`.  Captured empirically from a generated tree. */
const ALLOWLIST_PATTERN: Record<Backend, RegExp> = {
  // Hono route query schema: `sort: z.enum(["id", "name", …, ""]).default("id")`
  node: /sort:\s*z\.enum\(\[([^\]]*)\]\)/,
  // EF repository: `var sortColumn = sort switch { "name" => "Name", …, _ => "Id" };`
  dotnet: /sortColumn\s*=\s*sort switch\s*\{([^}]*)\}/,
  // Spring repository: `List.of("id", "name", …).contains(sort) ? sort : "id"`
  java: /__sortField\s*=\s*[\w.]*List\.of\(([^)]*)\)\.contains\(sort\)/,
  // SQLAlchemy repository: `_sort_columns = {"id": "id", "name": "name", …}`
  python: /_sort_columns\s*=\s*\{([^}]*)\}/,
  // Ecto repository: `case sort do\n  "name" -> :name\n  …\n  _ -> :id\nend`
  elixir: /case sort do\n([\s\S]*?)\n\s*end/,
};

/** Every emitted sort whitelist in the generated tree for `platform`.  A
 *  backend emits one per paged list read; asserting over ALL of them (rather
 *  than the first) keeps a second read path — a document store, an
 *  event-sourced projection — from slipping the masked key back in. */
async function emittedAllowlists(platform: Backend): Promise<string[]> {
  // `generateSystemFiles` asserts the fixture parses, AST-validates and
  // IR-validates clean before emitting — a whitelist read off a model the
  // product would refuse proves nothing about what a user can generate.
  const files = await generateSystemFiles(maskedSortDdd(platform));
  const pattern = new RegExp(ALLOWLIST_PATTERN[platform].source, "g");
  const out: string[] = [];
  for (const content of files.values()) {
    for (const m of content.matchAll(pattern)) out.push(m[1] ?? "");
  }
  return out;
}

describe("`mask unless` fields are absent from the emitted sort whitelist (M-T3.18)", () => {
  for (const platform of BACKENDS) {
    it(`${platform}: masked fields are dropped, unmasked siblings are kept`, async () => {
      const allowlists = await emittedAllowlists(platform);

      // The pattern must have MATCHED something — an extractor that silently
      // stops matching would turn both assertions below into vacuous truths
      // (experience_gathered.md §59: a check that never reaches the thing it
      // names reads as a pass).
      expect(
        allowlists.length,
        `${platform}: no sort whitelist found in the generated tree — the emitted ` +
          `shape changed and ${ALLOWLIST_PATTERN[platform]} no longer matches it. ` +
          `Re-capture the pattern; do NOT delete the row.`,
      ).toBeGreaterThan(0);

      for (const list of allowlists) {
        // The leak: ordering by a field the caller cannot read.
        expect(
          list,
          `${platform}: a \`mask unless\` field is an accepted \`?sort=\` key — ` +
            `ordering by it leaks the value the wire boundary redacts`,
        ).not.toMatch(/salary/);
        expect(list).not.toMatch(/nationalId/);

        // …and the fix is not "empty the whitelist": the unmasked scalar
        // siblings must still be sortable.
        expect(
          list,
          `${platform}: the unmasked sibling \`name\` was dropped too — the ` +
            `whitelist was emptied rather than filtered`,
        ).toMatch(/name/);
        expect(list).toMatch(/grade/);
      }
    });
  }
});

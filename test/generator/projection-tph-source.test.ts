// A query-time projection's DIRECT-TABLE arms (whole-table + grouped
// aggregation) over a TPH (`sharedTable`) CONCRETE source — eval item 10.
//
// A TPH concrete owns no table: its rows live in the root's shared table,
// discriminated by `kind`.  Before the fix:
//
//   node/drizzle   `.from(schema.autoClaims)` — no such export (TS2339)
//   node/mikroorm  `createQueryBuilder(AutoClaimRow, …)` — no such entity
//   python         `select_from(ClaimRow)` with NO `kind` filter — counted
//                  every sibling concrete's rows (silent wrong data)
//   elixir         `from(record in Api…AutoClaim, …)` over schema "claims"
//                  with NO `kind` conjunct — same silent wrong data
//
// All four now read the OWNER table (`projectionSourceTable`,
// src/ir/util/inheritance.ts) and AND the `kind` discriminator in.  The
// runtime half (the numbers) is the e2e block in
// test/fixtures/corpus/projection-tph-source.ddd.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const FIXTURE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../fixtures/corpus/projection-tph-source.ddd"),
  "utf8",
);

async function projectionSource(platform: string, pathRe: RegExp): Promise<string> {
  const files = await generateSystemFiles(FIXTURE.replace("__PLATFORM__", platform));
  const src = [...files.entries()]
    .filter(([p]) => pathRe.test(p))
    .map(([, c]) => c)
    .join("\n");
  expect(src, `${platform}: no projection source emitted`).not.toBe("");
  return src;
}

describe("projection over a TPH concrete reads the shared table, scoped by `kind`", () => {
  it("node/drizzle: owner table + kind conjunct on both direct-table arms", async () => {
    const src = await projectionSource("node", /query-projections\.ts$/);
    expect(src).not.toMatch(/schema\.autoClaims\b/);
    expect(src).toMatch(
      /\.from\(schema\.claims\)\.where\(eq\(schema\.claims\.kind, "AutoClaim"\)\)\.groupBy\(/,
    );
    expect(src).toMatch(
      /\[row\] = await db\.select\(\{ claims: count\(\) \}\)\.from\(schema\.claims\)\.where\(eq\(schema\.claims\.kind, "AutoClaim"\)\);/,
    );
    expect(src).toMatch(/import \{[^}]*\beq\b[^}]*\} from "drizzle-orm";/);
  }, 120_000);

  it("node/mikroorm: the root Row + a `{ kind }` filter", async () => {
    const src = await projectionSource("node { persistence: mikroorm }", /query-projections\.ts$/);
    expect(src).not.toMatch(/AutoClaimRow/);
    expect(src.match(/createQueryBuilder\(ClaimRow, "src"\)/g)?.length).toBe(2);
    expect(src.match(/qb\.where\(\{ kind: "AutoClaim" \}\);/g)?.length).toBe(2);
  }, 120_000);

  it("python: the kind conjunct on both direct-table arms", async () => {
    const src = await projectionSource("python", /query_projections_routes\.py$/);
    expect(
      src.match(/\.select_from\(ClaimRow\)\.where\(ClaimRow\.kind == "AutoClaim"\)/g)?.length,
    ).toBe(2);
  }, 120_000);

  it("elixir: the kind conjunct on both direct-table arms", async () => {
    const grouped = await projectionSource(
      "elixir",
      /query_projections\/auto_claims_by_status\.ex$/,
    );
    expect(grouped).toMatch(
      /from\(record in \S+\.AutoClaim, where: record\.kind == "AutoClaim", group_by:/,
    );
    const volume = await projectionSource("elixir", /query_projections\/auto_claim_volume\.ex$/);
    expect(volume).toMatch(
      /from\(record in \S+\.AutoClaim, where: record\.kind == "AutoClaim", select:/,
    );
  }, 120_000);
});

// Eval item 14b: vanilla Ecto stores a value object as ONE `:map` (jsonb)
// column, so `sum(b.amount.amount)` must extract + cast the leaf — the old
// `sum(record.amount)` was `sum(jsonb)`, a Postgres error at request time.
describe("elixir: a value-object leaf aggregates as a cast jsonb extraction", () => {
  it("sum(b.amount.amount) → sum(fragment(\"(?->>'amount')::numeric\", record.amount))", async () => {
    const src = await projectionSource("elixir", /query_projections\/bill_totals\.ex$/);
    expect(src).toContain(`total: sum(fragment("(?->>'amount')::numeric", record.amount))`);
    expect(src).not.toMatch(/sum\(record\.amount\)/);
  }, 120_000);
});

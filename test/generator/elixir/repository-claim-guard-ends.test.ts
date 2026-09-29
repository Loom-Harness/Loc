// F-018's elixir claim guards (#3081) — one `end` per guard.
//
// A claim-valued create stamp into a NOT NULL column makes `insert/2` refuse a
// principal whose claim is absent: each such stamp opens its own
// `if … do … else` block.  The first emit closed ONE `end` however many stamps
// there were, so a system with TWO claim stamps — a capability's
// `createdBy := currentUser.id` plus a context stamp `ownerRole :=
// currentUser.role` — emitted a repository module that does not compile
// (`missing terminator: end`).  Nothing in the fast suite had that shape; the
// `stamps-principal` corpus fixture did, and the elixir behavioural leg was the
// first to fail (`mix ecto.create` → compilation error).  This pins the
// balance where the fast suite runs.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const FIXTURE = new URL("../../fixtures/corpus/stamps-principal.ddd", import.meta.url);

function insertFn(files: Map<string, string>): string {
  const key = [...files.keys()].find((k) => k.endsWith("lib/d/desk/ticket_repository.ex"));
  if (!key) throw new Error("no ticket_repository.ex emitted");
  const src = files.get(key)!;
  const start = src.indexOf("  def insert(");
  const stop = src.indexOf("  @spec update(");
  if (start < 0 || stop < start) throw new Error("insert/2 not found in the repository module");
  return src.slice(start, stop);
}

describe("elixir repository — claim guards close one `end` each", () => {
  it("two claim-valued create stamps emit two nested guards and two matching ends", async () => {
    const source = readFileSync(FIXTURE, "utf8").replace(/__PLATFORM__/g, "elixir");
    const fn = insertFn(await generateSystemFiles(source));
    const guards = fn.match(/^    if current_user == nil or is_nil\(current_user\.\w+\)/gm) ?? [];
    expect(guards).toHaveLength(2);
    // The function body: N guard `end`s at 4-space indent, then the `def`'s own
    // `end` at 2-space indent — every `do` closed, nothing left open.
    const guardEnds = fn.match(/^    end$/gm) ?? [];
    expect(guardEnds).toHaveLength(guards.length);
    expect(fn.match(/^  end$/gm) ?? []).toHaveLength(1);
    // A crude but decisive balance check on the block keywords Elixir counts.
    const opens = (fn.match(/\bdo$/gm) ?? []).length;
    const closes = (fn.match(/^\s*end$/gm) ?? []).length;
    expect(closes).toBe(opens);
  });
});

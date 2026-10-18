// `loom.single-row-find-not-unique` — a find that returns ONE row by equality
// on fields no `unique (...)` covers returns whichever duplicate the database
// yields first.  Advisory: legal while the data happens to be unique.  The
// negatives carry the weight — an advisory that cries wolf gets muted.

import { describe, expect, it } from "vitest";
import { isAdvisoryCode } from "../../src/diagnostics/advisory.js";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/index.js";

const CODE = "loom.single-row-find-not-unique";

const sys = (agg: string, finds: string) => `
  system S { subdomain M { context C {
    aggregate Ticket with crudish { number: string  queue: string  open: bool ${agg} }
    repository Tickets for Ticket {
${finds}
    }
  }}}`;

async function flagged(agg: string, finds: string) {
  const { model } = await parseString(sys(agg, finds), { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model))).filter((d) => d.code === CODE);
}

describe(CODE, () => {
  it("flags a clause-less single-row find with no matching unique", async () => {
    const d = await flagged("", "find byNumber(number: string): Ticket?");
    expect(d).toHaveLength(1);
    expect(d[0]!.severity).toBe("warning");
    expect(d[0]!.message).toContain("find 'byNumber' returns a single 'Ticket' by (number)");
    expect(d[0]!.message).toContain("Declare 'unique (number)'");
    expect(isAdvisoryCode(d[0]!.code)).toBe(true);
  });

  it("flags an explicit `where this.f == p` single-row find", async () => {
    const d = await flagged("", "find byNum(n: string): Ticket? where this.number == n");
    expect(d.map((x) => x.source)).toEqual(["C/Tickets.byNum"]);
  });

  it("is quiet once `unique (number)` covers the key", async () => {
    expect(await flagged("unique (number)", "find byNumber(number: string): Ticket?")).toEqual([]);
  });

  it("is quiet when a composite unique is covered by a wider key match", async () => {
    expect(
      await flagged(
        "unique (queue, number)",
        "find byQueueAndNumber(queue: string, number: string): Ticket? where this.queue == queue && this.number == number",
      ),
    ).toEqual([]);
  });

  it("still flags when the unique key needs a field the find does not match", async () => {
    const d = await flagged("unique (queue, number)", "find byNumber(number: string): Ticket?");
    expect(d).toHaveLength(1);
  });

  it("is quiet on list finds and on non-equality filters", async () => {
    expect(
      await flagged(
        "",
        [
          "find inQueue(queue: string): Ticket[]",
          "find firstOpenAfter(number: string): Ticket? where this.number > number",
          "find either(number: string, queue: string): Ticket? where this.number == number || this.queue == queue",
        ].join("\n"),
      ),
    ).toEqual([]);
  });
});

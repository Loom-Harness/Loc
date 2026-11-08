// A union-returning operation whose `return match { … }` arms build DIFFERENT
// variants answers each arm's own tag, on all five backends.  The whole value
// has no single variant: tagging it once (with the statically first arm's
// variant) made java/.NET construct that variant with nulls, node/python label
// every arm with its tag, and elixir wrap the whole `cond` in the error tuple
// when the first arm was the error variant.
//
// The behavioural witness is the `union-match-arms` corpus case
// (test/fixtures/corpus/union-match-arms.ddd), booted on every leg.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { allContexts, type StmtIR } from "../../src/ir/types/loom-ir.js";
import { distributeUnionReturn } from "../../src/ir/util/union-return.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { parseString } from "../_helpers/parse.js";

const FIXTURE = readFileSync("test/fixtures/corpus/union-match-arms.ddd", "utf8");

/** The fixture plus a domain service answering per arm. */
const SERVICE = FIXTURE.replace(
  "      aggregate Ticket with crudish {",
  `      domainService Triage {
        operation triage(kind: string, notes: string): Repaired or Rejected {
          return match {
            kind == "reject" => Rejected { reason: notes },
            else => Repaired { notes: notes }
          }
        }
      }

      aggregate Ticket with crudish {`,
);

/** The fixture plus a variant-form `return match` over a sibling op's union
 *  (elixir refuses the `let`-bound op call, `loom.vanilla-op-call-position`). */
const VARIANT = FIXTURE.replace(
  "      aggregate Ticket with crudish {",
  `      aggregate Ticket with crudish {
        operation swap(kind: string, notes: string): Repaired or Replaced {
          let r = resolve(kind, notes)
          return match r {
            Repaired x => Replaced { part: x.notes },
            Replaced y => Repaired { notes: y.part }
          }
        }`,
);

async function files(platform: string, src = FIXTURE): Promise<Map<string, string>> {
  return generateSystemFiles(src.replace("__PLATFORM__", platform));
}

function find(fs: Map<string, string>, suffix: string): string {
  const hit = [...fs.entries()].find(([p]) => p.endsWith(suffix));
  if (!hit) throw new Error(`no generated file ending in ${suffix}`);
  return hit[1];
}

/** The text of a method/function from its signature line to the next blank
 *  line at its own indent — enough to assert on a whole body. */
function body(src: string, signature: string): string {
  const start = src.indexOf(signature);
  if (start < 0) throw new Error(`signature not found: ${signature}`);
  const end = src.indexOf("\n\n", start);
  return src.slice(start, end < 0 ? undefined : end);
}

async function returnOf(opName: string): Promise<Extract<StmtIR, { kind: "return" }>> {
  const { model } = await parseString(VARIANT.replace("__PLATFORM__", "node"), {
    validate: false,
  });
  const agg = allContexts(lowerModel(model))
    .find((c) => c.name === "Desk")!
    .aggregates.find((a) => a.name === "Ticket")!;
  const op = agg.operations.find((o) => o.name === opName)!;
  const ret = op.statements.at(-1)!;
  if (ret.kind !== "return") throw new Error(`${opName} does not end in a return`);
  return ret;
}

describe("return match — lowering tags each arm", () => {
  it("records one variant per arm, then the `else`, and no whole-value tag", async () => {
    const ret = await returnOf("close");
    expect(ret.variantTag).toBeUndefined();
    expect(ret.armVariants).toEqual([
      { variantTag: "Rejected", variantShape: "record" },
      { variantTag: "Repaired", variantShape: "record" },
      { variantTag: "Replaced", variantShape: "record" },
    ]);
  });

  it("tags the variant form per arm, reading each arm's binding at its variant", async () => {
    const ret = await returnOf("swap");
    expect(ret.armVariants?.map((v) => v.variantTag)).toEqual(["Replaced", "Repaired"]);
  });

  it("expands into one tagged `return` per arm", async () => {
    const out = distributeUnionReturn(await returnOf("decide"));
    expect(out.kind).toBe("if");
    if (out.kind !== "if") return;
    expect(out.thenBody).toMatchObject([{ kind: "return", variantTag: "Rejected" }]);
    expect(out.elseBody).toMatchObject([{ kind: "return", variantTag: "Repaired" }]);
  });
});

describe("return match — every backend answers the arm's own variant", () => {
  it("node: a tagged `return` per arm", async () => {
    const ticket = find(await files("node"), "domain/ticket.ts");
    const close = body(ticket, "public close(");
    expect(close).toContain('return { type: "Rejected", ...(({ reason: this._title })) };');
    expect(close).toContain('return { type: "Repaired", ...(({ notes: notes })) };');
    expect(close).toContain('return { type: "Replaced", ...(({ part: notes })) };');
    expect(close).not.toMatch(/type: "Rejected", \.\.\.\(\(kind/);
  });

  it("python: a tagged dict per arm", async () => {
    const ticket = find(await files("python"), "app/domain/ticket.py");
    const decide = body(ticket, "def decide(");
    expect(decide).toContain('return {"type": "Rejected", **{"reason": self._title}}');
    expect(decide).toContain('return {"type": "Repaired", **{"notes": notes}}');
  });

  it("java: each arm constructs its own variant record from its own fields", async () => {
    const ticket = find(await files("java"), "/Ticket.java");
    const resolve = body(ticket, "public RepairedOrReplaced resolve(");
    expect(resolve).toContain("return new RepairedOrReplaced_Repaired(this.title);");
    expect(resolve).toContain("return new RepairedOrReplaced_Replaced(notes);");
    expect(resolve).not.toContain("(null)");
  });

  it(".NET: each arm constructs its own variant record from its own fields", async () => {
    const ticket = find(await files("dotnet"), "/Ticket.cs");
    const decide = body(ticket, "public RepairedOrRejected Decide(");
    expect(decide).toContain("return new RepairedOrRejected_Rejected(this.Title);");
    expect(decide).toContain("return new RepairedOrRejected_Repaired(notes);");
    expect(decide).not.toContain("(default)");
  });

  it("elixir: a `cond` answering each arm's own tuple, the error one only on its arm", async () => {
    const ctx = find(await files("elixir"), "/lib/d/desk.ex");
    const decide = body(ctx, "def decide_ticket(%");
    // `Ticket` is versioned, so the success arm persists its version bump (as
    // every backend's save-after-command does): the arm is decided first.
    expect(decide).toContain(
      [
        "    loom_arm_result =",
        "      cond do",
        '        kind == "reject" ->',
        '          {:error, "Rejected", %{reason: record.title}}',
        "        true ->",
        '          {:ok, Map.put(%{notes: notes}, :type, "Repaired")}',
        "      end",
      ].join("\n"),
    );
    expect(decide).not.toContain('{:error, "Rejected", %{value: cond');
    // The whole function: a persisting body carries blank lines.
    const resolveAt = ctx.indexOf("def resolve_ticket(%");
    const resolve = ctx.slice(resolveAt, ctx.indexOf("\n  end\n", resolveAt));
    expect(resolve).toContain('{:ok, Map.put(%{notes: record.title}, :type, "Repaired")}');
    expect(resolve).toContain('{:ok, Map.put(%{part: notes}, :type, "Replaced")}');
  });

  it("elixir: a mutating op persists only when a success arm runs", async () => {
    const ctx = find(await files("elixir"), "/lib/d/desk.ex");
    const close = ctx.slice(ctx.indexOf("def close_ticket(%"));
    const decided = close.indexOf("loom_arm_result =");
    const persisted = close.indexOf("persist_change(changeset)");
    expect(decided).toBeGreaterThan(-1);
    // The arm is decided BEFORE the write, and the error arm returns early.
    expect(decided).toBeLessThan(persisted);
    expect(close).toContain(
      ["      {:error, _, _} = failure ->", "        failure", "", "      {:ok, _} ->"].join("\n"),
    );
  });

  it("domain services answer each arm's own variant", async () => {
    const node = find(await files("node", SERVICE), "domain/services.ts");
    expect(body(node, "triage(")).toContain(
      'return { type: "Rejected", ...(({ reason: notes })) };',
    );
    const elixir = find(await files("elixir", SERVICE), "/domain/services/triage.ex");
    expect(elixir).toContain('{:error, "Rejected", %{reason: notes}}');
    expect(elixir).toContain("{:ok, %{notes: notes}}");
    expect(elixir).not.toContain("%{value: cond");
    const java = [...(await files("java", SERVICE)).entries()].find(([p]) =>
      p.endsWith("/Triage.java"),
    )?.[1];
    expect(java).toContain("return new RepairedOrRejected_Rejected(notes);");
  });

  it("the variant form dispatches on the subject and tags each arm", async () => {
    const java = find(await files("java", VARIANT), "/Ticket.java");
    const swap = body(java, "public RepairedOrReplaced swap(");
    expect(swap).toContain("return new RepairedOrReplaced_Replaced(x.notes());");
    expect(swap).toContain("return new RepairedOrReplaced_Repaired(y.part());");
  });
});

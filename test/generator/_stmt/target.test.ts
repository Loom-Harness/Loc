import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  renderStmtChunksWith,
  renderStmtsWith,
  type StmtIndex,
  type StmtTarget,
} from "../../../src/generator/_stmt/target.js";
import type { StmtIR } from "../../../src/ir/types/loom-ir.js";
import { irTypesSource } from "../../_helpers/ir-types-source.js";

// ---------------------------------------------------------------------------
// The shared `StmtIR` spine (`renderStmtsWith` / `renderStmtChunksWith`) owns
// the ONLY dispatch for the Hono/.NET/Java/Python operation-body statement
// renderers — a bug here breaks four backends at once (audit finding C1,
// https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/audits/generator-code-review-2026-08-17.md).
//
// Two things are gated:
//   1. COVERAGE — every `StmtIR` kind is a `StmtTarget` method.  The
//      exhaustive `switch` + the interface
//      already make a new kind a COMPILE error in `src/`, but `test/` is not in
//      the `tsc -b` project, so this reads both source files and pins the sets
//      textually: a new kind that nobody wired fails here even if someone
//      widened the switch with a `default`.
//   2. BEHAVIOUR — dispatch order, chunk granularity, the join equivalence, and
//      the two temp-index models — via a recording mock target.
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");

/** Kind literals declared by the `StmtIR` union in the IR types module. */
function stmtIrKinds(): string[] {
  const src = irTypesSource();
  const start = src.indexOf("export type StmtIR =");
  expect(start, "StmtIR union found in the IR types").toBeGreaterThan(-1);
  // Up to the next top-level `export` declaration (the union's own arms never
  // start a line at column 0).
  const rest = src.slice(start + 1);
  const end = rest.indexOf("\nexport ");
  const block = end === -1 ? rest : rest.slice(0, end);
  return [...block.matchAll(/kind: "([a-z-]+)"/g)].map((m) => m[1]!);
}

/** Kinds the `StmtTarget` interface claims, read off its `ByKind<"…">` params. */
function stmtTargetKinds(): string[] {
  const src = fs.readFileSync(
    path.join(repoRoot, "src", "generator", "_stmt", "target.ts"),
    "utf8",
  );
  const iface = src.slice(src.indexOf("export interface StmtTarget {"));
  return [...iface.matchAll(/^ {2}\w+\(s: ByKind<"([a-z-]+)">/gm)].map((m) => m[1]!);
}

describe("StmtTarget — exhaustive StmtIR kind coverage", () => {
  it("every StmtIR kind is a target method", () => {
    const irKinds = stmtIrKinds();
    expect(irKinds.length).toBeGreaterThan(5); // the slice actually found the union
    const covered = new Set(stmtTargetKinds());
    const missing = irKinds.filter((k) => !covered.has(k));
    expect(missing, "a new StmtIR kind needs a StmtTarget method").toEqual([]);
  });

  it("declares no target method for a kind the IR no longer has", () => {
    const irKinds = new Set(stmtIrKinds());
    const orphaned = stmtTargetKinds().filter((k) => !irKinds.has(k));
    expect(orphaned, "StmtTarget method for a removed StmtIR kind").toEqual([]);
  });
});

/** Build a `StmtIR` of `kind` with just enough shape for the spine.  The mock
 *  target reads only `kind` (+ `prov` for the per-kind index model), so
 *  unrelated required fields are cast away. */
function stmt(kind: StmtIR["kind"], extra: Record<string, unknown> = {}): StmtIR {
  return { kind, ...extra } as unknown as StmtIR;
}

/** A target whose every leaf emits `"<KIND>#<pre>/<prov>"` and records the
 *  call, so dispatch order and the temp-index model are both observable. */
function recordingTarget(indexing: StmtTarget["indexing"]): {
  target: StmtTarget;
  calls: { kind: string; ix: StmtIndex }[];
} {
  const calls: { kind: string; ix: StmtIndex }[] = [];
  const leaf =
    (kind: string) =>
    (_s: never, ix: StmtIndex): string => {
      calls.push({ kind, ix });
      return `${kind}#${ix.pre}/${ix.prov}`;
    };
  const target: StmtTarget = {
    backendName: "MOCK",
    indexing,
    precondition: leaf("precondition"),
    requires: leaf("requires"),
    let: leaf("let"),
    assign: leaf("assign"),
    add: leaf("add"),
    remove: leaf("remove"),
    emit: leaf("emit"),
    call: leaf("call"),
    expression: leaf("expression"),
    return: leaf("return"),
    if: (_s, ix, thenSrc, elseSrc) => {
      calls.push({ kind: "if", ix });
      return elseSrc === undefined
        ? `if#${ix.pre}/${ix.prov}[${thenSrc}]`
        : `if#${ix.pre}/${ix.prov}[${thenSrc}][${elseSrc}]`;
    },
    variantMatch: (_s, ix, m) => {
      calls.push({ kind: "variant-match", ix });
      const arms = m.arms.map(
        (a) => `${a.tag}${a.binding ? ` ${a.binding}` : ""}${a.scalar ? "!" : ""}[${a.body}]`,
      );
      const tail = m.else === undefined ? "" : `else[${m.else}]`;
      return `match#${ix.pre}/${ix.prov}<${m.unionName}>${arms.join("")}${tail}${m.exhaustive ? "*" : ""}`;
    },
    presenceMatch: (_s, ix, present, absent) => {
      calls.push({ kind: "presence-match", ix });
      return `present#${ix.pre}/${ix.prov}[${present ?? "-"}][${absent ?? "-"}]`;
    },
  };
  return { target, calls };
}

/** One statement of every dispatched kind, in interface order. */
const ALL_KINDS: StmtIR["kind"][] = [
  "precondition",
  "requires",
  "let",
  "assign",
  "add",
  "remove",
  "emit",
  "call",
  "expression",
  "return",
  "if",
];

describe("renderStmtsWith / renderStmtChunksWith — shared statement spine", () => {
  it("dispatches every kind to its own target method, in body order", () => {
    const { target, calls } = recordingTarget("positional");
    // `if` needs a (here empty) then-body — the spine renders it before the arm.
    const body = ALL_KINDS.map((k) => (k === "if" ? stmt(k, { thenBody: [] }) : stmt(k)));

    const out = renderStmtsWith(body, target);

    expect(calls.map((c) => c.kind)).toEqual(ALL_KINDS);
    expect(out.split("\n")).toHaveLength(ALL_KINDS.length);
  });

  it("returns one chunk per statement, and the joined form is chunks.join('\\n')", () => {
    const { target } = recordingTarget("positional");
    const body = [stmt("let"), stmt("assign"), stmt("return")];

    const chunks = renderStmtChunksWith(body, target);

    expect(chunks).toHaveLength(3);
    const { target: t2 } = recordingTarget("positional");
    expect(renderStmtsWith(body, t2)).toBe(chunks.join("\n"));
  });

  it("keeps a multi-line chunk inside its own statement's chunk", () => {
    const target: StmtTarget = {
      ...recordingTarget("positional").target,
      remove: () => "line-a\nline-b\nline-c",
    };
    const chunks = renderStmtChunksWith([stmt("emit"), stmt("remove")], target);
    expect(chunks).toHaveLength(2);
    expect(chunks[1]).toBe("line-a\nline-b\nline-c");
  });

  it("numbers temps POSITIONALLY for node/.NET/java targets", () => {
    const { target, calls } = recordingTarget("positional");
    renderStmtsWith(
      [stmt("let"), stmt("precondition"), stmt("assign", { prov: {} }), stmt("precondition")],
      target,
    );
    // Both indices are simply the statement's position in the body.
    expect(calls.map((c) => [c.ix.pre, c.ix.prov])).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });

  it("numbers temps PER KIND for the python target (preserved inconsistency)", () => {
    const { target, calls } = recordingTarget("per-kind");
    renderStmtsWith(
      [
        stmt("let"),
        stmt("precondition"),
        stmt("assign", { prov: {} }),
        stmt("precondition"),
        stmt("assign"), // unprovenanced — does NOT consume a prov index
        stmt("add", { prov: {} }),
      ],
      target,
    );
    // `pre` counts only preconditions; `prov` only provenanced assign/add.
    expect(calls.map((c) => `${c.kind}:${c.ix.pre}/${c.ix.prov}`)).toEqual([
      "let:0/0",
      "precondition:0/0",
      "assign:0/0",
      "precondition:1/0",
      "assign:0/0",
      "add:0/1",
    ]);
  });

  it("renders an empty body to an empty string and no chunks", () => {
    const { target, calls } = recordingTarget("positional");
    expect(renderStmtChunksWith([], target)).toEqual([]);
    expect(renderStmtsWith([], target)).toBe("");
    expect(calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// `if` — the one backend-body kind that NESTS (M-FT.11).
// ---------------------------------------------------------------------------

describe("renderStmtsWith — `if` branch recursion", () => {
  it("renders both branch bodies with the SAME target and hands them to the arm", () => {
    const { target, calls } = recordingTarget("positional");
    const body = [
      stmt("if", { thenBody: [stmt("assign")], elseBody: [stmt("emit"), stmt("return")] }),
    ];

    const out = renderStmtsWith(body, target);

    // The branches dispatch through the same leaf table, BEFORE the `if` arm
    // itself (the spine renders the bodies to pass them in).
    expect(calls.map((c) => c.kind)).toEqual(["assign", "emit", "return", "if"]);
    expect(out).toBe("if#0/0[assign#1/1][emit#2/2\nreturn#3/3]");
  });

  it("passes `undefined` (not an empty string) for an absent else-branch", () => {
    const { target } = recordingTarget("positional");
    const out = renderStmtsWith([stmt("if", { thenBody: [stmt("assign")] })], target);
    expect(out).toBe("if#0/0[assign#1/1]");
  });

  it("keeps the whole nested render inside the `if`'s own chunk", () => {
    const { target } = recordingTarget("positional");
    const chunks = renderStmtChunksWith(
      [stmt("let"), stmt("if", { thenBody: [stmt("assign"), stmt("emit")] })],
      target,
    );
    expect(chunks).toHaveLength(2);
    expect(chunks[1]).toContain("assign");
    expect(chunks[1]).toContain("emit");
  });

  // Why the counters are threaded rather than restarted per block: C# and Java
  // reject a nested block that shadows an enclosing local (CS0136), so a traced
  // body whose outer and inner statement both bound `__pre_0_ok` would not
  // compile.  Positional numbering counts nested statements too.
  it("numbers temps uniquely ACROSS nesting — no nested block restarts at 0", () => {
    const { target, calls } = recordingTarget("positional");
    renderStmtsWith(
      [
        stmt("precondition"),
        stmt("if", { thenBody: [stmt("precondition"), stmt("precondition")] }),
        stmt("precondition"),
      ],
      target,
    );
    const pres = calls.filter((c) => c.kind === "precondition").map((c) => c.ix.pre);
    expect(new Set(pres).size, `duplicate temp indices: ${pres.join(",")}`).toBe(pres.length);
  });

  it("keeps per-kind (python) numbering unique across nesting too", () => {
    const { target, calls } = recordingTarget("per-kind");
    renderStmtsWith(
      [
        stmt("precondition"),
        stmt("if", { thenBody: [stmt("precondition")], elseBody: [stmt("precondition")] }),
      ],
      target,
    );
    const pres = calls.filter((c) => c.kind === "precondition").map((c) => c.ix.pre);
    expect(new Set(pres).size, `duplicate temp indices: ${pres.join(",")}`).toBe(pres.length);
  });
});

// ---------------------------------------------------------------------------
// `variant-match` — the statement `match`, the other nesting kind.
// ---------------------------------------------------------------------------

const RC = { kind: "entity", name: "Receipt" } as const;
const REJ = { kind: "entity", name: "Rejected" } as const;
const STR = { kind: "primitive", name: "string" } as const;
const readOf = (name: string) =>
  stmt("assign", {
    value: { kind: "ref", name, refKind: "match-binding", type: STR },
  });

describe("renderStmtsWith — `variant-match` dispatch", () => {
  it("hands a tagged match its arms pre-rendered, with tag, binding and scalar flag", () => {
    const { target, calls } = recordingTarget("positional");
    const out = renderStmtsWith(
      [
        stmt("variant-match", {
          subject: { kind: "ref", name: "r", refKind: "let" },
          subjectType: { kind: "union", variants: [STR, REJ] },
          arms: [
            { varType: STR, binding: "s", body: [readOf("s")] },
            { varType: REJ, binding: "e", isError: true, body: [stmt("emit", { fields: [] })] },
          ],
        }),
      ],
      target,
    );
    // Arm bodies render first, through the same table; the arm read by its
    // body keeps its binding, the one whose body never reads it drops it.
    expect(calls.map((c) => c.kind)).toEqual(["assign", "emit", "variant-match"]);
    expect(out).toBe("match#0/0<stringOrRejected>string s![assign#1/1]Rejected[emit#2/2]*");
  });

  it("passes the else body and marks a match that leaves a variant out", () => {
    const { target } = recordingTarget("positional");
    const out = renderStmtsWith(
      [
        stmt("variant-match", {
          subject: { kind: "ref", name: "r", refKind: "let" },
          subjectType: { kind: "union", variants: [RC, REJ] },
          arms: [{ varType: RC, body: [stmt("emit")] }],
          elseBody: [stmt("return")],
        }),
      ],
      target,
    );
    expect(out).toBe("match#0/0<ReceiptOrRejected>Receipt[emit#1/1]else[return#2/2]");
  });

  it("renders a `T?` subject as a presence split, the else filling the side no arm names", () => {
    const { target, calls } = recordingTarget("positional");
    const out = renderStmtsWith(
      [
        stmt("variant-match", {
          subject: { kind: "ref", name: "n", refKind: "param" },
          subjectType: { kind: "optional", inner: STR },
          subjectShape: "absence",
          arms: [{ varType: STR, binding: "s", body: [stmt("assign")] }],
          elseBody: [stmt("emit")],
        }),
      ],
      target,
    );
    expect(calls.map((c) => c.kind)).toEqual(["assign", "emit", "presence-match"]);
    expect(out).toBe("present#0/0[assign#1/1][emit#2/2]");
  });

  it("passes `undefined` for a presence side nothing covers", () => {
    const { target } = recordingTarget("positional");
    const out = renderStmtsWith(
      [
        stmt("variant-match", {
          subject: { kind: "ref", name: "n", refKind: "param" },
          subjectType: { kind: "optional", inner: STR },
          subjectShape: "absence",
          arms: [{ varType: STR, body: [stmt("assign")] }],
        }),
      ],
      target,
    );
    expect(out).toBe("present#0/0[assign#1/1][-]");
  });
});

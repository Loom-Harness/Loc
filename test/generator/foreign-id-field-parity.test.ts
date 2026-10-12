// An `X id` on a hosted declaration whose target lives in a sibling context
// the deployable does NOT host declares its brand locally, on every typed
// backend (D18 of `eval-claims/FIX-PLAN.md`).
//
// `claimDesk` hosts `Claims` only, and names `PolId` from a field, an optional and
// a list field, an operation param, an event field and a find param.  The ids
// module used to declare only the hosted aggregates' brands (plus foreign
// event / workflow / user-claim ids), so every typed backend referenced a brand
// that existed nowhere — node TS2694, python name-defined (an ImportError at
// boot), .NET CS0246, javac "cannot find symbol".  The source is the CORPUS
// fixture, so this fast gate and the per-backend compile legs read one `.ddd`.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";
import type { Backend } from "../fixtures/corpus/backends.js";
import { corpusSourceFor } from "../fixtures/corpus/harness.js";

/** The `claimDesk` deployable's files only (it hosts `Claims`, not `Policies`). */
async function emitClaims(backend: Backend): Promise<Map<string, string>> {
  const all = await generateSystemFiles(corpusSourceFor("foreign-id-field", backend));
  return new Map([...all].filter(([p]) => p.startsWith("claim_desk/")));
}

function file(files: Map<string, string>, suffix: string): string {
  const hit = [...files.entries()].find(([p]) => p.endsWith(suffix));
  if (!hit) {
    throw new Error(
      `no emitted file ends with '${suffix}' — emitted:\n  ${[...files.keys()].join("\n  ")}`,
    );
  }
  return hit[1];
}

describe("an id naming a NON-hosted sibling aggregate — the brand is declared locally", () => {
  it("node: domain/ids.ts exports the PolId brand the domain class names", async () => {
    const files = await emitClaims("node");
    expect(file(files, "domain/clm.ts")).toContain("Ids.PolId");
    expect(file(files, "domain/ids.ts")).toContain("export type PolId =");
  });

  it("python: ids.py declares PolId, and the repository ports import it", async () => {
    const files = await emitClaims("python");
    expect(file(files, "app/domain/ids.py")).toContain('PolId = NewType("PolId", str)');
    const ports = file(files, "app/domain/repository_ports.py");
    expect(ports).toContain("p: PolId");
    expect(ports).toMatch(/^from app\.domain\.ids import .*\bPolId\b/m);
  });

  it("dotnet: Domain/Ids/PolId.cs exists", async () => {
    const files = await emitClaims("dotnet");
    expect(file(files, "Domain/Ids/PolId.cs")).toContain("record struct PolId(");
  });

  it("java: domain/ids/PolId.java exists", async () => {
    const files = await emitClaims("java");
    expect(file(files, "domain/ids/PolId.java")).toContain("public record PolId(");
  });
});

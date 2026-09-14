// F-023 (#2922 / #2926) — a `workflow` + a Feliz UI emitted F# that referenced
// a `Model` field the `Model` record never declared.
//
// The scaffold synthesises `<Wf>InstancesList` / `<Wf>InstanceDetail` pages for
// every observable workflow, and their bodies read `<Wf>.instances.all` /
// `.byId(id)`.  The VIEW walk resolved those (its context carries the
// workflows) and emitted `model.AllWs` / `model.WById`; the READ COLLECTOR did
// not (its detector context omitted `workflowsByName`, so the detector's
// workflow-instance patterns never matched), and the `Model` record is built
// from the collected reads.  Result, from a `.ddd` that validates clean:
//
//   error FSHARP: The type 'Model' does not define the field, constructor or
//   member 'AllWs'.  Maybe you want one of the following: AllFollows
//
// The gate below is written against the INVARIANT, not the two field names:
// every `model.<X>` the emitted `App.fs` references must be a field the `Model`
// record declares.  That is exactly what `dotnet fable` checks, and it catches
// any future read shape that walks without being collected.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const SYSTEM = `
  system P {
    subdomain S {
      context C {
        aggregate Member with crudish {
          handle: string
          derived display: string = handle
        }
        aggregate Note with crudish {
          body: string
          member: Member id
        }
        event Pinged { member: Member id }
        channel Ch { carries: Pinged }

        workflow W {
          memberId: Member id
          // A starter is REQUIRED: a reactor-only workflow never has an
          // instance to route to, so every inbound event logs event_unrouted
          // and returns (refused by loom.reactor-without-starter, M-T5.34).
          // This command create names the correlation field, so it is
          // addressable — and the workflow still gets the synthesised
          // <Wf>InstancesList / <Wf>InstanceDetail pages this test is about.
          create(memberId: Member id) { }
          on(e: Pinged) by e.member {
            memberId := e.member
          }
        }
      }
    }
    ui WF with scaffold(subdomains: [S]) { framework: feliz }
    storage primary { type: postgres }
    resource s { for: C, kind: state, use: primary }
    deployable api { platform: node  contexts: [C]  dataSources: [s]  port: 3000 }
    deployable webF { platform: feliz  targets: api  ui: WF  port: 3005 }
  }
`;

let cached: string | undefined;
async function appFs(): Promise<string> {
  if (cached === undefined) {
    const files = await generateSystemFiles(SYSTEM);
    cached = [...files.entries()]
      .filter(([p]) => p.endsWith("App.fs"))
      .map(([, c]) => c)
      .join("\n");
    expect(cached.length, "an App.fs was emitted").toBeGreaterThan(0);
  }
  return cached;
}

/** The field names the `Model` record declares. */
function modelFields(src: string): string[] {
  const m = /type Model =\n\s*\{([\s\S]*?)\n\s*\}/.exec(src);
  return (m?.[1] ?? "")
    .split("\n")
    .map((l) => /^\s*([A-Za-z_]\w*)\s*:/.exec(l)?.[1])
    .filter((n): n is string => n !== undefined);
}

describe("F-023 — a workflow's instance pages declare the Model fields they read", () => {
  it("declares every `model.<X>` the emitted App.fs references", async () => {
    const src = await appFs();
    const declared = new Set(modelFields(src));
    expect(declared.size, "the Model record was parsed").toBeGreaterThan(0);
    const referenced = new Set([...src.matchAll(/\bmodel\.([A-Za-z_]\w*)/g)].map((m) => m[1]!));
    const undeclaredRefs = [...referenced].filter((r) => !declared.has(r));
    expect(undeclaredRefs).toEqual([]);
  });

  it("declares the two workflow-instance reads specifically", async () => {
    const src = await appFs();
    const declared = modelFields(src);
    expect(declared).toContain("AllWs");
    expect(declared).toContain("WById");
    // …and the pages that made them necessary actually read them.
    expect(src).toContain("model.AllWs");
    expect(src).toContain("model.WById");
  });

  it("emits the instance record and its Thoth decoder", async () => {
    const src = await appFs();
    // Built from the workflow's `instanceWireShape` — the same shape the
    // backends serve `GET /api/workflows/<wf>/instances` from.
    expect(src).toMatch(/(?:type|and) WInstance =/);
    expect(src).toMatch(/wInstance : Decoder<WInstance> =/);
    expect(src).toContain('memberId = get.Required.Field "memberId" Decode.string');
  });

  it("fetches the documented instance routes", async () => {
    const src = await appFs();
    expect(src).toContain('Http.get "/api/workflows/w/instances"');
    expect(src).toContain('sprintf "/api/workflows/w/instances/%s" id');
    // The list is a bare JSON array (not a paged envelope), matching every
    // backend's `/instances` handler.
    expect(src).toContain("Decode.list Decoders.wInstance");
    expect(src).toContain("Decode.option Decoders.wInstance");
  });
});

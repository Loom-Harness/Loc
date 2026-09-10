// A `command`-typed workflow `create` parameter must have a WIRE TYPE on
// every backend (#2864 D7 / T2, mission M-T6.67a).
//
// `create(c: FileClaim)`, where `FileClaim` is a declared `command`, is the
// explicit-command starter `docs/workflow.md` documents, and `docs/payloads.md`
// §1 names a workflow `create` / `handle` parameter as the FIRST position
// where a payload is admissible as a type.  Every backend emitted a request
// record referencing a wire type for the payload, and NO backend emitted that
// type:
//
//   node    `z.object({ c: z.unknown() })`     — compiles, no contract at all;
//                                                every `c.<field>` is TS18046
//   python  `c: FileClaimResponse`             — undefined name
//   java    `record …Request(FileClaimResponse c)` — undefined type
//   dotnet  the same, PLUS `record …Command(FileClaim C)` naming an
//           undefined DOMAIN record
//   elixir  `c: …Schemas.FileClaimResponse`    — no `file_claim_response.ex`
//
// A payload record is a flat record — the same shape a value object already
// gets a wire type for — so each backend now emits it.  Three things are
// pinned per backend, because fixing only the first trades one compile error
// for another:
//
//   1. the WIRE record exists, under the name the request DTO references;
//   2. the request DTO's field is typed by it (NOT `unknown`);
//   3. the param is COERCED to its domain form before the body reads it —
//      an `X id` field has to arrive branded or the first
//      `Agg.create({ ref: c.<idField> })` downstream is a type error.
//
// The workflow here is deliberately STATELESS.  #2850 (M-T6.60 / F58) owns the
// command-create receiver + saga-row seam, and its correlation rule is "the
// create param that name-matches the correlation field" — a payload param
// named `c` never name-matches, so this shape is outside that fix either way.
// Keeping the workflow stateless keeps the two concerns from overlapping.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

const system = (platform: string) => `
  system ClaimIntake {
    subdomain Claims {
      context Claims {
        aggregate Cargo with crudish { code: string }
        repository Cargos for Cargo { }
        aggregate Claim with crudish {
          cargo: Cargo id
          description: string
          amount: money
          note: string?
        }
        repository Claims for Claim { }
        command FileClaim {
          cargo: Cargo id
          description: string
          amount: money
          note: string?
        }
        workflow ClaimHandling {
          create(c: FileClaim) {
            let claim = Claim.create({
              cargo: c.cargo,
              description: c.description,
              amount: c.amount,
              note: c.note
            })
          }
        }
      }
    }
    api ClaimsApi from Claims
    storage pg { type: postgres }
    resource claimsState { for: Claims, kind: state, use: pg }
    deployable d {
      platform: ${platform}
      contexts: [Claims]
      dataSources: [claimsState]
      serves: ClaimsApi
      port: 4000
    }
  }
`;

/** Every emitted file joined — the payload's wire record lands in a different
 *  file per backend (an own module on elixir, the pooled workflows file on
 *  node/python, a per-record file on java/dotnet), and this test is about the
 *  TYPE existing, not about where each backend files it. */
const allFiles = async (platform: string): Promise<string> => {
  const files = await generateSystemFiles(system(platform));
  return [...files.values()].join("\n\n");
};

const fileNames = async (platform: string): Promise<string[]> => {
  const files = await generateSystemFiles(system(platform));
  return [...files.keys()];
};

describe("a command-typed workflow create param carries a wire type (#2864 D7/T2)", () => {
  it("node: the request schema is the payload's zod object, not z.unknown()", async () => {
    const out = await allFiles("node");
    // The payload's own schema is declared…
    expect(out).toContain(`const FileClaimResponse = z.object({`);
    // …the request references it…
    expect(out).toContain(`  c: FileClaimResponse,`);
    // …and the uncontracted shape is gone.  This is the assertion that fails
    // when the fix is reverted: `zodFor`'s `entity` arm renders `z.unknown()`.
    expect(out).not.toContain(`  c: z.unknown(),`);
  });

  it("node: the payload param is coerced to its domain form (branded id)", async () => {
    // Without this the body's `Claim.create({ cargo: c.cargo })` is TS2322 —
    // `string` is not assignable to the branded `CargoId`.
    expect(await allFiles("node")).toContain(
      `const c = { cargo: Ids.CargoId(body.c.cargo), description: body.c.description, amount: body.c.amount, note: (body.c.note == null ? null : body.c.note) };`,
    );
  });

  it("node: a money field inside the payload schema imports moneySchema", async () => {
    // Scoped to the WORKFLOWS file on purpose.  Asserted over the joined
    // output this passes vacuously — every per-aggregate routes file already
    // imports `moneySchema`, so the assertion never reaches the file under
    // test (`experience_gathered.md` §59's "a check that never reaches the
    // thing it names").  The workflows file is the one that renders
    // `amount: moneySchema` in the payload schema and never imported it.
    const files = await generateSystemFiles(system("node"));
    const workflows = files.get("d/http/workflows.ts");
    expect(workflows, "d/http/workflows.ts emitted").toBeDefined();
    expect(workflows).toContain(`amount: moneySchema,`);
    expect(workflows).toContain(`import { moneySchema } from "../lib/schemas";`);
  });

  it("python: the wire model and the domain dataclass are both emitted", async () => {
    const out = await allFiles("python");
    expect(out).toContain(`class FileClaimResponse(BaseModel):`);
    expect(out).toContain(`class FileClaim:`);
    expect(out).toContain(`    c: FileClaimResponse`);
    // Coerced, not passed through: `c = body.c` left `c.cargo` a `str`.
    expect(out).toContain(
      `c = FileClaim(CargoId(body.c.cargo), body.c.description, Decimal(body.c.amount), body.c.note)`,
    );
  });

  it("java: the wire record and the domain record are both emitted", async () => {
    const out = await allFiles("java");
    expect(out).toContain(`public record FileClaimResponse(`);
    expect(out).toContain(`public record FileClaim(`);
    expect(out).toContain(`public record ClaimHandlingRequest(FileClaimResponse c) {`);
    // The `to<Payload>` mapper, the twin of the VO path's `to<Vo>`.
    expect(out).toContain(`private static FileClaim toFileClaim(FileClaimResponse request) {`);
    expect(out).toContain(`var c = toFileClaim(request.c());`);
  });

  it("java: the new component carries a required set in the OpenAPI customizer", async () => {
    // springdoc marks nothing required on a plain record, while the other four
    // backends all publish one for this component (zod / pydantic derive it,
    // .NET carries `[Required]`).  Without this the component lands as a fresh
    // `required-only-java` row in the 5-way parity diff.  `note` is optional
    // and must be absent from the set.
    expect(await allFiles("java")).toContain(
      `new RequiredSet("FileClaimResponse", List.of("amount", "cargo", "description")),`,
    );
  });

  it("dotnet: BOTH the wire record and the domain record are emitted", async () => {
    const out = await allFiles("dotnet");
    // The Request DTO's type…
    expect(out).toContain(`public sealed record FileClaimResponse(`);
    // …and the Command record's type.  Emitting only the first trades CS0246
    // for CS1503 at `new ClaimHandlingCommand(request.C)`.
    // Spelled in full on purpose: `renderCsType` already renders an
    // `optional(T)` as `T?`, so adding the field's own `optional` flag on top
    // emitted `string?? Note` — output that GENERATES cleanly and is not C#,
    // which no generation-tier gate can see.
    expect(out).toContain(
      `public sealed record FileClaim(CargoId Cargo, string Description, decimal Amount, string? Note);`,
    );
    expect(out).toContain(`public sealed record ClaimHandlingCommand(FileClaim C) : ICommand;`);
    // The controller materializes one from the other, field by field.
    expect(out).toContain(`new FileClaim(new CargoId(request.C.Cargo)`);
  });

  it("dotnet: the domain record survives the ambient-kernel prune", async () => {
    // `pruneUnreferencedAmbientKernel` reads `Domain/ValueObjects/<X>.cs` as
    // "declares the type X" and drops the file when nothing else names X — so
    // the record must live in a file named for the type, not in a pooled one.
    expect(await fileNames("dotnet")).toContain("d/Domain/ValueObjects/FileClaim.cs");
  });

  it("elixir: the referenced schema module is emitted", async () => {
    expect(await fileNames("elixir")).toContain("d/lib/d_web/api/schemas/file_claim_response.ex");
    const out = await allFiles("elixir");
    expect(out).toContain(`defmodule DWeb.Api.Schemas.FileClaimResponse do`);
    expect(out).toContain(`c: DWeb.Api.Schemas.FileClaimResponse`);
  });

  it("all five publish the SAME OpenAPI component name for the payload", async () => {
    // The five backends' request DTOs already agreed on the `<Payload>Response`
    // spelling (their shared wire-type mappers render an `entity` reference
    // that way) — they just never emitted it.  Emitting under any other name
    // on one backend would fork the published contract.
    for (const platform of ["node", "dotnet", "python", "java", "elixir"]) {
      expect(await allFiles(platform), platform).toContain("FileClaimResponse");
    }
  });
});

// A payload field that is itself a VALUE OBJECT — the same dangling-reference
// class, one level down.  `collectReachableTypes` descends through a value
// object's fields but not through a payload's (a payload leaf is an `entity`),
// so a closure seeded from `wf.params` alone misses a VO reachable only
// THROUGH a payload, and the emitted `<Payload>Response` then names a
// `<Vo>Request` / `<Vo>Schema` no pass emitted.  `workflowParamTypeSeeds` is
// the shared seed list that closes it.
const voFieldSystem = (platform: string) => `
  system VoField {
    subdomain S {
      context S {
        valueobject Money2 { amount: decimal  currency: string }
        aggregate Claim with crudish { total: Money2 }
        repository Claims for Claim { }
        command FileClaim { total: Money2 }
        workflow ClaimHandling {
          create(c: FileClaim) {
            let cl = Claim.create({ total: c.total })
          }
        }
      }
    }
    api A from S
    storage pg { type: postgres }
    resource st { for: S, kind: state, use: pg }
    deployable d { platform: ${platform} contexts: [S] dataSources: [st] serves: A port: 4000 }
  }
`;

const voFieldFiles = async (platform: string): Promise<string> => {
  const files = await generateSystemFiles(voFieldSystem(platform));
  return [...files.values()].join("\n\n");
};

describe("a value object reached only through a payload param still resolves", () => {
  it("node: the payload schema's VO field references an emitted Money2Schema", async () => {
    const files = await generateSystemFiles(voFieldSystem("node"));
    const workflows = files.get("d/http/workflows.ts");
    expect(workflows).toContain(`const Money2Schema = z.object({`);
    expect(workflows).toContain(`  total: Money2Schema,`);
    expect(workflows).toContain(
      `const c = { total: new Money2(body.c.total.amount, body.c.total.currency) };`,
    );
  });

  it("dotnet: Money2Request is emitted into the Workflows namespace", async () => {
    // The aggregate's own `Money2Request` lives in `Application.Claims.Requests`,
    // which `WorkflowPayloads.cs` does not `using` — so the workflow namespace
    // needs its own copy, the same way a VO-typed PARAM already gets one.
    const files = await generateSystemFiles(voFieldSystem("dotnet"));
    const wfRequests = files.get("d/Application/Workflows/WorkflowRequests.cs");
    expect(wfRequests, "WorkflowRequests.cs emitted for a VO reached via a payload").toBeDefined();
    expect(wfRequests).toContain(`public sealed record Money2Request(`);
    expect(files.get("d/Application/Workflows/WorkflowPayloads.cs")).toContain(
      `public sealed record FileClaimResponse([Required] Money2Request Total);`,
    );
  });

  it("java: the payload wire record imports Money2Request and the mapper exists", async () => {
    const out = await voFieldFiles("java");
    expect(out).toContain(`import com.loom.d.features.claims.Money2Request;`);
    expect(out).toContain(`private static Money2 toMoney2(Money2Request request) {`);
    expect(out).toContain(`return new FileClaim(toMoney2(request.total()));`);
  });

  it("python: the VO wire model is imported and the domain VO constructed", async () => {
    const out = await voFieldFiles("python");
    expect(out).toContain(`from app.http.wire_models import Money2 as Money2Model`);
    expect(out).toContain(`    total: Money2Model`);
    expect(out).toContain(`c = FileClaim(Money2(body.c.total.amount, body.c.total.currency))`);
  });

  it("elixir: both schema modules are emitted", async () => {
    const files = await generateSystemFiles(voFieldSystem("elixir"));
    const names = [...files.keys()];
    expect(names).toContain("d/lib/d_web/api/schemas/file_claim_response.ex");
    expect(names).toContain("d/lib/d_web/api/schemas/money2.ex");
  });
});

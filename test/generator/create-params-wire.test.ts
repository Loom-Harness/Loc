// A declared `create(…)`'s parameter list IS the create request contract on
// every backend and every create surface the scaffold emits.
//
// The fixture is the corpus `create-contract.ddd` (also the booted forged-body
// gate's, `test/behavioral/create-contract.mjs`):
// `create(patient, minutes, fee)` on an Appointment that also carries a
// `when`-gated `status: AppointmentStatus = Requested`, a `notes: string?`, and
// defaulted / bool / collection fields.  None of those may appear in a create
// request schema, and the domain factory must seed each from its declaration.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

const FIXTURE = readFileSync(join(__dirname, "..", "behavioral", "create-contract.ddd"), "utf8");
const NOT_PARAMS = ["status", "notes", "room", "priority", "urgent", "tags"];

const withPlatform = (p: string, ui = false) => {
  const src = FIXTURE.replace("__PLATFORM__", p);
  if (!ui) return src;
  return src
    .replace(
      "  storage primary",
      "  ui Front with scaffold(subdomains: [Care]) { }\n\n  storage primary",
    )
    .replace(
      /\n}\s*$/,
      "\n  deployable web { platform: react, targets: d, ui: Front, port: 3001 }\n}\n",
    );
};

function file(files: Map<string, string>, suffix: string): string {
  const hit = [...files.entries()].find(([p]) => p.endsWith(suffix));
  expect(hit, `no emitted file ending ${suffix}`).toBeDefined();
  return hit![1];
}

/** The text between `start` and the first `end` after it. */
function slice(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  expect(a, `missing ${start}`).toBeGreaterThanOrEqual(0);
  const b = src.indexOf(end, a + start.length);
  return src.slice(a, b < 0 ? undefined : b);
}

function expectOnlyParams(schema: string, spell: (n: string) => string, label: string) {
  for (const p of ["patient", "minutes", "fee"])
    expect(schema, `${label}: ${p}`).toContain(spell(p));
  for (const n of NOT_PARAMS) expect(schema, `${label} must not take ${n}`).not.toContain(spell(n));
}

describe("the create request schema is the declared param list", () => {
  it("node — the zod request schema and the factory", async () => {
    const files = await generateSystemFiles(withPlatform("node"));
    const routes = file(files, "api/http/appointment.routes.ts");
    expectOnlyParams(
      slice(
        routes,
        "const CreateAppointmentRequest = z.object({",
        '}).openapi("CreateAppointmentRequest")',
      ),
      (n) => `${n}:`,
      "zod",
    );
    const domain = file(files, "api/domain/appointment.ts");
    expect(domain).toContain(
      "static create(input: { patient: string; minutes: number; fee: Fee }): Appointment {",
    );
    expect(domain).toContain("status: AppointmentStatus.Requested,");
    expect(domain).toContain('room: "A1",');
    expect(domain).toContain("priority: 3,");
  });

  it("dotnet — the request record and the domain factory", async () => {
    const files = await generateSystemFiles(withPlatform("dotnet"));
    const req = file(files, "Requests/AppointmentRequests.cs");
    expectOnlyParams(
      slice(req, "public sealed record CreateAppointmentRequest(", ");"),
      (n) => ` ${n[0]!.toUpperCase()}${n.slice(1)}`,
      ".NET",
    );
    const domain = file(files, "Domain/Appointments/Appointment.cs");
    expect(domain).toContain(
      "public static Appointment Create(string patient, int minutes, Fee fee)",
    );
    expect(domain).toContain("e.Status = AppointmentStatus.Requested;");
  });

  it("java — the request record and the domain factory", async () => {
    const files = await generateSystemFiles(withPlatform("java"));
    const req = file(files, "appointments/CreateAppointmentRequest.java");
    expectOnlyParams(
      slice(req, "public record CreateAppointmentRequest(", ")"),
      (n) => ` ${n}`,
      "java",
    );
    const domain = file(files, "appointments/Appointment.java");
    expect(domain).toContain(
      "public static Appointment create(String patient, int minutes, Fee fee)",
    );
    expect(domain).toContain("e.status = AppointmentStatus.Requested;");
  });

  it("python — the pydantic request model and the factory", async () => {
    const files = await generateSystemFiles(withPlatform("python"));
    const routes = file(files, "app/http/appointment_routes.py");
    expectOnlyParams(
      slice(routes, "class CreateAppointmentRequest(BaseModel):", "\n\n"),
      (n) => `    ${n}:`,
      "pydantic",
    );
    const domain = file(files, "app/domain/appointment.py");
    expect(domain).toContain("status=AppointmentStatus.Requested,");
  });

  it("elixir — the OpenApiSpex schema and every create seam narrows its attrs", async () => {
    const files = await generateSystemFiles(withPlatform("elixir"));
    const schema = file(files, "schemas/create_appointment_request.ex");
    expectOnlyParams(slice(schema, "properties: %{", "}\n"), (n) => `${n}:`, "OpenApiSpex");
    const cs = file(files, "scheduling/appointment_changeset.ex");
    expect(cs).toContain("@create_fields [:patient, :minutes, :fee]");
    expect(cs).toContain("def take_create_attrs(attrs) when is_map(attrs) do");
    // The `__default` arms cover every field the take drops.
    expect(cs).toContain("|> __default(:status, :Requested)");
    const repo = file(files, "scheduling/appointment_repository.ex");
    expect(repo).toContain("attrs = Api.Scheduling.AppointmentChangeset.take_create_attrs(attrs)");
    const dom = file(files, "scheduling/appointment.ex");
    expect(dom).toContain("take_create_attrs(attrs)");
  });

  it("react — the scaffolded create form and api client carry only the params", async () => {
    const files = await generateSystemFiles(withPlatform("node", true));
    const page = file(files, "web/src/pages/appointments/new.tsx");
    expect(page).not.toContain('label="Status"');
    expect(page).not.toContain("appointments-new-input-status");
    expect(page).toContain("appointments-new-input-patient");
    const client = file(files, "web/src/api/appointment.ts");
    expectOnlyParams(
      slice(client, "CreateAppointmentRequest", "})"),
      (n) => `  ${n}:`,
      "frontend zod",
    );
  });
});

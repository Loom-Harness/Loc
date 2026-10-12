// A state-based canonical `create` body RUNS: its `precondition` and `emit`
// (`createBodyStatements`, src/ir/util/op-gates.ts) are rendered on all five
// backends, against the constructed instance, like an operation body.
//
// The fixture is the corpus `create-contract.ddd`, whose create carries
//
//     precondition patient.length > 0 message "A patient is required"
//     emit AppointmentRequested { appointment: id, patient: patient, minutes: minutes }
//
// The runtime proof is `test/behavioral/create-contract.mjs` (a booted Hono
// backend: the 422 and the dispatched event) and the corpus behavioural legs.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

const FIXTURE = readFileSync(
  join(__dirname, "..", "fixtures", "corpus", "create-contract.ddd"),
  "utf8",
);
const on = (p: string) => generateSystemFiles(FIXTURE.replace("__PLATFORM__", p));

function file(files: Map<string, string>, suffix: string): string {
  const hit = [...files.entries()].find(([p]) => p.endsWith(suffix));
  expect(hit, `no emitted file ending ${suffix}`).toBeDefined();
  return hit![1];
}

/** `needle`'s index in `hay`, asserted present. */
function at(hay: string, needle: string): number {
  const i = hay.indexOf(needle);
  expect(i, `missing: ${needle}`).toBeGreaterThanOrEqual(0);
  return i;
}

describe("the canonical create body runs on every backend", () => {
  it("node — the factory calls a private body method after construction", async () => {
    const src = file(await on("node"), "d/domain/appointment.ts");
    const call = at(src, "inst._createBody(input.patient, input.minutes);");
    expect(call).toBeGreaterThan(at(src, "const inst = new Appointment({"));
    expect(src).toContain("private _createBody(patient: string, minutes: number): void {");
    expect(src).toContain(
      'if (!([...patient].length > 0)) throw new DomainError("A patient is required", "msg.4rnahg", "/patient");',
    );
    expect(src).toContain(
      'this._events.push({ type: "AppointmentRequested", appointment: this._id, patient: patient, minutes: minutes });',
    );
  });

  it("dotnet — Create runs _CreateBody after the invariant check", async () => {
    const src = file(await on("dotnet"), "Domain/Appointments/Appointment.cs");
    expect(src).toContain("e._CreateBody(patient, minutes);");
    expect(src).toContain("private void _CreateBody(string patient, int minutes)");
    expect(src).toContain('"A patient is required"');
    expect(src).toContain("new AppointmentRequested(");
  });

  it("java — create runs _createBody", async () => {
    const src = file(await on("java"), "appointments/Appointment.java");
    expect(src).toContain("e._createBody(patient, minutes);");
    expect(src).toContain("private void _createBody(String patient, int minutes) {");
    expect(src).toContain('"A patient is required"');
    expect(src).toContain("new AppointmentRequested(");
  });

  it("python — create runs _create_body", async () => {
    const src = file(await on("python"), "app/domain/appointment.py");
    expect(src).toContain("inst._create_body(patient, minutes)");
    expect(src).toContain("def _create_body(self, patient: str, minutes: int) -> None:");
    expect(src).toContain('"A patient is required"');
    expect(src).toContain("AppointmentRequested(");
  });

  it("elixir — the context create guards the draft, inserts, then dispatches; the pure core guards too", async () => {
    const files = await on("elixir");
    const ctx = file(files, "lib/d/scheduling.ex");
    const fn = ctx.slice(at(ctx, "def create_appointment(attrs) do"));
    const guard = at(
      fn,
      ':ok <- ensure(length(String.to_charlist(patient)) > 0, {:precondition_failed, %{detail: "A patient is required"',
    );
    const insert = at(fn, "case D.Scheduling.AppointmentRepository.insert(attrs) do");
    const event = at(
      fn,
      "loom_event_0 = %D.Scheduling.Events.AppointmentRequested{appointment: record.id",
    );
    expect(guard).toBeLessThan(insert);
    expect(insert).toBeLessThan(event);
    expect(fn.slice(0, insert)).toContain("patient = record.patient");
    // The controller maps the denial to the domain-floor 422.
    const ctl = file(files, "controllers/appointment_controller.ex");
    expect(ctl).toContain("{:error, {:precondition_failed, detail}} ->");
    // The pure domain core (the unit tests' `Appointment.create`) guards too,
    // and binds only the param its guard reads.
    const core = file(files, "lib/d/scheduling/appointment.ex");
    expect(core).toContain('{:error, {:precondition_failed, "A patient is required"}}');
    expect(core.slice(at(core, "def create(attrs)"), at(core, "def confirm("))).not.toContain(
      "minutes = record.minutes",
    );
  });
});

// Sensitivity is a field fact, not a type fact (D-SENSITIVE-INSPECT-ONLY): a
// value read from a `sensitive(...)` field has the field's plain type, so no
// flow boundary — assignment, derived, function return, emitted event field —
// compares or reports tags.  Sink classification of sensitive fields is
// field-level and lives elsewhere.

import { describe, expect, it } from "vitest";
import { parseString } from "../../_helpers/index.js";

describe("sensitivity flow is not tracked through types", () => {
  it("a sensitive value flowing into clean slots raises no diagnostic", async () => {
    const { errors, warnings } = await parseString(`
      context T {
        event PatientRenamed { patientId: Patient id, newName: string }
        aggregate Patient {
          name:  string
          email: string sensitive(pii)
          derived label: string = email
          function nickname(): string = "Mr. " + email
          operation flow() {
            name := email
            emit PatientRenamed { patientId: id, newName: email }
          }
        }
        repository Patients for Patient { }
      }
    `);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });
});

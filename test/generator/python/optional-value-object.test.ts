// ---------------------------------------------------------------------------
// An OPTIONAL value object on the Python (FastAPI / SQLAlchemy) backend.
//
// A VO field has no column of its own — it flattens into the owner table's leaf
// columns — and making it optional keeps that flattening while turning every
// one of those leaves nullable.  Two independent things broke on that shape,
// both found by the `corpus/optional-valueobject` fixture and neither visible
// to the generation-only gate:
//
//  1. HYDRATE.  The `is not None` probe narrows only the ONE column it reads, so
//     the remaining leaves stay `str | None` / `Decimal | None` against a
//     constructor wanting the bare type:
//
//       person_repository.py:95: error: Argument 3 to "Addr" has incompatible
//         type "str | None"; expected "str"   [arg-type]
//
//     Inside the guard the VO is known present, so each REQUIRED leaf is
//     unwrapped by `required()` — the python spelling of the node backend's `!`,
//     with a runtime guard rather than a bare assertion.  A subfield that is
//     optional IN THE VO keeps its own null, which is exactly why "assert every
//     leaf non-null" is not the fix.
//
//  2. WIRE.  Pydantic reads `X | None` with NO DEFAULT as required-but-nullable,
//     so a body that simply omits an optional VO subfield is rejected:
//
//       POST /api/persons -> 422
//         {"pointer": "/home/line2", "message": "Field required"}
//
//     The aggregate's own optional fields always carried `= None`
//     (`routes-builder`); the nested VO model in `wire_models.py` never did.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SYSTEM = `system OptVo {
  subdomain S {
    context C {
      valueobject Addr {
        line1: string
        line2: string?
        city: string
        rent: money
      }
      aggregate Person with crudish {
        name: string
        home: Addr
        office: Addr?
      }
      repository Persons for Person { }
    }
  }
  api A from S
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable d {
    platform: python
    contexts: [C]
    dataSources: [st]
    serves: A
    port: 4000
  }
}`;

async function emitted(suffix: string): Promise<string> {
  const files = await generateSystemFiles(SYSTEM);
  for (const [p, c] of files) if (p.endsWith(suffix)) return c;
  throw new Error(`${suffix} not found in: ${[...files.keys()].join(", ")}`);
}

describe("python: an optional value object hydrates and deserialises", () => {
  it("unwraps every REQUIRED leaf of the optional VO, and only those", async () => {
    const repo = await emitted("/person_repository.py");
    const hydrate = repo.split("\n").find((l) => l.includes("office=("))!;
    expect(hydrate, "optional VO hydrate not emitted").toBeDefined();

    // The probe narrows only itself; the other required leaves need the unwrap.
    expect(hydrate).toContain("required(row.office_city)");
    expect(hydrate).toContain("required(row.office_rent)");
    // `line2` is optional INSIDE the VO — with the VO present it really can be
    // null, so unwrapping it would be wrong.
    expect(hydrate).not.toContain("required(row.office_line2)");
    // The REQUIRED sibling VO's leaves are non-nullable columns already.
    const home = repo.split("\n").find((l) => l.includes("home=Addr("))!;
    expect(home).not.toContain("required(");
  });

  it("imports `required` only where a hydrate uses it", async () => {
    const repo = await emitted("/person_repository.py");
    expect(repo).toMatch(/^from app\.db\.wire import .*\brequired\b/m);
    // The helper itself is a runtime guard, not a bare cast: reaching `None`
    // there means a half-written leaf group, i.e. a corrupt row.
    const wire = await emitted("/app/db/wire.py");
    expect(wire).toContain("def required(value: _T | None) -> _T:");
    expect(wire).toContain('raise ValueError("value-object leaf is unexpectedly NULL")');
  });

  it("gives an optional VO SUBFIELD a wire default, so the body may omit it", async () => {
    const models = await emitted("/app/http/wire_models.py");
    expect(models).toMatch(/^\s+line2: .*\| None = None$/m);
    // A required subfield must stay required — the default is not blanket.
    expect(models).not.toMatch(/^\s+line1: .*= None$/m);
    expect(models).not.toMatch(/^\s+city: .*= None$/m);
  });
});

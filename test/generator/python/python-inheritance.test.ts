import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateSystems } from "../../../src/system/index.js";
import { parseString } from "../../_helpers/index.js";

// ---------------------------------------------------------------------------
// Python backend — aggregate inheritance (plan S13).  TPH: one shared
// kind-discriminated table named for the base, concrete repos
// kind-scope every read and stamp kind on save; TPC: standalone
// concrete tables.  Both get the base union alias + read-only reader.
// Verified live against Postgres during the slice (kind scoping,
// round-trips, both readers).
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = fs.readFileSync(
  path.resolve(here, "../../e2e/fixtures/python-build/inheritance.ddd"),
  "utf8",
);

async function build() {
  const { model, errors } = await parseString(FIXTURE);
  if (errors.length) throw new Error(`fixture has validation errors:\n${errors.join("\n")}`);
  return generateSystems(model).files;
}

describe("python TPH inheritance", () => {
  it("the base owns ONE shared table with kind + nullable own columns", async () => {
    const files = await build();
    const schema = files.get("api/app/db/schema.py")!;
    expect(schema).toContain("class PartyRow(Base):");
    expect(schema).toContain('    __tablename__ = "parties"');
    expect(schema).toContain("    kind: Mapped[str] = mapped_column(Text)");
    // Concrete-own columns forced nullable.
    expect(schema).toContain("    credit_limit: Mapped[int | None] = mapped_column(Integer)");
    expect(schema).toContain("    rating: Mapped[int | None] = mapped_column(Integer)");
  });

  it("maps the hierarchy natively: polymorphic_on the root, one identity per concrete", async () => {
    const schema = (await build()).get("api/app/db/schema.py")!;
    expect(schema).toContain(
      '    __mapper_args__ = {"polymorphic_on": "kind", "polymorphic_abstract": True}',
    );
    expect(schema).toContain(
      'class CustomerRow(PartyRow):\n    __mapper_args__ = {"polymorphic_identity": "Customer"}',
    );
    expect(schema).toContain(
      'class VendorRow(PartyRow):\n    __mapper_args__ = {"polymorphic_identity": "Vendor"}',
    );
  });

  it("concrete repos read their mapped subclass, stamp kind on save, assert-narrow own fields", async () => {
    const files = await build();
    const repo = files.get("api/app/db/repositories/customer_repository.py")!;
    // SQLAlchemy adds `kind IN ('Customer')` to every `select(CustomerRow)`.
    expect(repo).toContain("select(CustomerRow).where((CustomerRow.email == email))");
    expect(repo).not.toMatch(/\.kind == "Customer"\)\)\)/);
    // The upsert writes the shared table and keeps its write-path guard.
    expect(repo).toContain('"kind": "Customer",');
    expect(repo).toContain("assert row.credit_limit is not None");
  });

  it("the TPH base reader is one polymorphic select, hydrating each row as its subclass", async () => {
    const files = await build();
    const reader = files.get("api/app/db/repositories/party_repository.py")!;
    expect(reader).toContain("class PartyRepository:");
    expect(reader).toContain("select(PartyRow).order_by(PartyRow.id.asc())");
    expect(reader).toContain("if isinstance(row, CustomerRow):");
    expect(reader).toContain("if isinstance(row, VendorRow):");
    expect(reader).not.toContain("row.kind ==");
    const union = files.get("api/app/domain/party.py")!;
    expect(union).toContain("Party = Customer | Vendor");
  });
});

describe("python TPC inheritance", () => {
  it("each concrete is standalone; the base owns no table", async () => {
    const files = await build();
    const schema = files.get("api/app/db/schema.py")!;
    expect(schema).toContain("class MachineRow(Base):");
    expect(schema).toContain("class VehicleRow(Base):");
    expect(schema).not.toContain("class AssetRow");
  });

  it("the TPC base reader unions the concrete repositories", async () => {
    const files = await build();
    const reader = files.get("api/app/db/repositories/asset_repository.py")!;
    expect(reader).toContain(
      "out.extend(await MachineRepository(self._session, self._events).all())",
    );
    expect(reader).toContain(
      "out.extend(await VehicleRepository(self._session, self._events).all())",
    );
    const union = files.get("api/app/domain/asset.py")!;
    expect(union).toContain("Asset = Machine | Vehicle");
  });
});

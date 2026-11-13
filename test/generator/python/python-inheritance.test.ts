import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

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
  return generateSystemFiles(FIXTURE);
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

// A base whose concrete masks a field (or gates its `all` behind `requires`)
// is routed like any other: the route checks every concrete's list gate before
// the load and the reader masks that concrete's rows.  A base with a concrete
// that serves no list read of its own has no `GET /<bases>` route, so nothing
// pages it and its reader renders no `find_page`.  Whichever way that predicate
// falls, every module importing `app.domain.paging` must find it emitted.
const MASKED_BASE = (inheritance: "sharedTable" | "ownTable", withRepository = true) => `
system S {
  user { id: guid  role: string  permissions: string[] }
  subdomain Core {
    permissions { unmask }
    context Main {
      abstract aggregate ThingBase inheritanceUsing: ${inheritance} { note: string }
      aggregate Thing extends ThingBase with crudish {
        label: string
        ssn: string mask unless currentUser.permissions.contains(permissions.unmask)
      }
      ${withRepository ? "repository Things for Thing { }" : ""}
    }
  }
  api MainApi from Core
  storage primary { type: postgres }
  resource mainState { for: Main, kind: state, use: primary }
  deployable d { platform: python  contexts: [Main]  dataSources: [mainState]  serves: MainApi  port: 4000  auth: required }
}
`;

function pagingImportersWithoutModule(files: Map<string, string>, root: string): string[] {
  if (files.has(`${root}/app/domain/paging.py`)) return [];
  return [...files]
    .filter(([p, c]) => p.endsWith(".py") && c.includes("app.domain.paging"))
    .map(([p]) => p);
}

describe("python base reader paging", () => {
  for (const inheritance of ["sharedTable", "ownTable"] as const) {
    it(`a masked ${inheritance} base is routed: it pages, masks per row, and its paging module is emitted`, async () => {
      const files = await generateSystemFiles(MASKED_BASE(inheritance));
      const reader = files.get("d/app/db/repositories/thing_base_repository.py")!;
      expect(files.has("d/app/http/thing_base_routes.py")).toBe(true);
      expect(pagingImportersWithoutModule(files, "d")).toEqual([]);
      expect(reader).toContain("def find_page(");
      // String tier: the wire effect (a null `ssn` for a caller without the
      // permission) is the inheritance-read-gates corpus fixture's.
      expect(reader).toContain(".to_wire_masked(root)");
    });
  }

  it("a routed base reader keeps find_page and its paging module", async () => {
    const files = await build();
    expect(files.get("api/app/db/repositories/party_repository.py")).toContain("def find_page(");
    expect(files.get("api/app/db/repositories/asset_repository.py")).toContain("def find_page(");
    expect(files.has("api/app/domain/paging.py")).toBe(true);
  });
});

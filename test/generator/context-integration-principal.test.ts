import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

// ---------------------------------------------------------------------------
// Context integration tests run as a principal: under an `auth: required`
// deployable every backend binds the test principal (`testPrincipal`, the
// dev-stub identity with the test's `as { … }` claims set) through the same
// request-scoped seam its auth middleware binds, and rebinds it at an
// `as { … }` body line.
// The two-principal fixture is the tenant-isolation proof: a note written as
// `acme` is not readable as `beta`.
// ---------------------------------------------------------------------------

const src = (platform: string) => `
system P {
  user { id: guid  tenantId: string  roles: string[] }
  tenancy by user.tenantId of Org
  subdomain S {
    context C {
      aggregate Org with crudish { name: string }
      aggregate Note with tenantOwned, crudish { text: string }
      repository Notes for Note { }
      repository Orgs for Org { }
      test "a note reads back" {
        let n = Note.create(text: "hi")
        let r = Note.get(n.id)
        expect(r.text).toBe("hi")
      }
      test "beta cannot read acme's note" as { tenantId: "acme", roles: ["agent"] } {
        let n = Note.create(text: "acme only")
        as { tenantId: "beta" }
        let r = Note.find(n.id)
        expect(r).toBeNull()
      }
    }
  }
  api A from S
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable d { platform: ${platform}  contexts: [C]  dataSources: [st]  serves: A  port: 4000  auth: required }
}`;

const get = (files: Map<string, string>, suffix: string): string => {
  const hit = [...files.entries()].find(([p]) => p.endsWith(suffix));
  if (!hit) throw new Error(`no emitted file ends with ${suffix}`);
  return hit[1];
};

describe("context integration tests bind a principal", () => {
  it("node: runAsUser over the test principal; actAsUser at an `as` line", async () => {
    const files = await generateSystemFiles(src("node"));
    const t = get(files, "test/c.integration.test.ts");
    expect(t).toContain(`import { actAsUser, runAsUser } from "../auth/middleware";`);
    expect(t).toContain(
      `runAsUser({ id: "00000000-0000-0000-0000-000000000000", tenantId: "admin", roles: [] }, async () => {`,
    );
    expect(t).toContain(
      `runAsUser({ id: "00000000-0000-0000-0000-000000000000", tenantId: "acme", roles: ["agent"] }, async () => {`,
    );
    expect(t).toContain(
      `await actAsUser({ id: "00000000-0000-0000-0000-000000000000", tenantId: "beta", roles: [] });`,
    );
    // The read asserted null is still a nullable read.
    expect(t).toContain(`const r = (await repos.note.findById(n.id))!;`);
    // The seam the test binds through is the one the middleware builds from.
    const mw = get(files, "auth/middleware.ts");
    expect(mw).toContain("export async function runAsUser<T>(claims: UserClaims");
    expect(mw).toContain("export async function actAsUser(claims: UserClaims)");
    expect(get(files, "auth/dev-stub.ts")).toContain(
      "export function devStubClaims(): UserClaims {",
    );
  });

  it("python: binds current_user_var; stamps the create; keeps a null read nullable", async () => {
    const files = await generateSystemFiles(src("python"));
    const t = get(files, "tests/test_c_integration.py");
    expect(t).toContain("    current_user_var.set(principal)");
    expect(t).toContain(
      `    _act_as(User(id="00000000-0000-0000-0000-000000000000", tenant_id="admin", roles=[]))`,
    );
    expect(t).toContain(
      `    _act_as(User(id="00000000-0000-0000-0000-000000000000", tenant_id="acme", roles=["agent"]))`,
    );
    expect(t).toContain(
      `    _act_as(User(id="00000000-0000-0000-0000-000000000000", tenant_id="beta", roles=[]))`,
    );
    expect(t).toContain("        n._stamp_on_create(__principal)");
    expect(t).toContain("    r = await note_repo.find_by_id(n.id)\n    assert r is None");
  });

  it("dotnet: a request frame + HttpContextCurrentUserAccessor (no CS7036) + the interceptor", async () => {
    const files = await generateSystemFiles(src("dotnet"));
    const t = get(files, "CIntegrationTests.cs");
    expect(t).toContain("new AppDbContext(opts, new HttpContextCurrentUserAccessor())");
    expect(t).toContain(".AddInterceptors(new AuditableInterceptor())");
    expect(t).toContain(
      `using var __principal = ActAs(new User(Id: System.Guid.Parse("00000000-0000-0000-0000-000000000000"), TenantId: "admin", Roles: new System.Collections.Generic.List<string>()));`,
    );
    expect(t).toContain(
      `using var __principal = ActAs(new User(Id: System.Guid.Parse("00000000-0000-0000-0000-000000000000"), TenantId: "acme", Roles: new System.Collections.Generic.List<string> { "agent" }));`,
    );
    expect(t).toContain(
      `using var __principal1 = ActAs(new User(Id: System.Guid.Parse("00000000-0000-0000-0000-000000000000"), TenantId: "beta", Roles: new System.Collections.Generic.List<string>()));`,
    );
    expect(t).toContain("var r = await noteRepo.GetByIdAsync(n.Id);");
    expect(t).toContain("using D.Auth;");
  });

  it("java: CurrentUserAccessor.actAs per test and per `as` line, cleared after each", async () => {
    const files = await generateSystemFiles(src("java"));
    const t = get(files, "CIntegrationTests.java");
    expect(t).toContain(
      `CurrentUserAccessor.actAs(new User(UUID.fromString("00000000-0000-0000-0000-000000000000"), "admin", List.of()));`,
    );
    expect(t).toContain(
      `CurrentUserAccessor.actAs(new User(UUID.fromString("00000000-0000-0000-0000-000000000000"), "acme", List.of("agent")));`,
    );
    expect(t).toContain(
      `CurrentUserAccessor.actAs(new User(UUID.fromString("00000000-0000-0000-0000-000000000000"), "beta", List.of()));`,
    );
    expect(t).toContain("@AfterEach");
    expect(t).toContain("var r = noteRepository.findById(n.id()).orElse(null);");
    expect(get(files, "auth/CurrentUserAccessor.java")).toContain(
      "public static void actAs(User user) {",
    );
  });

  it("elixir: the actor is threaded into every scoped context call", async () => {
    const files = await generateSystemFiles(src("elixir"));
    const t = get(files, "test/c_integration_test.exs");
    expect(t).toContain(
      `current_user = DWeb.Auth.as_principal(%{id: "00000000-0000-0000-0000-000000000000", tenant_id: "admin", roles: []})`,
    );
    expect(t).toContain(
      `current_user = DWeb.Auth.as_principal(%{id: "00000000-0000-0000-0000-000000000000", tenant_id: "acme", roles: ["agent"]})`,
    );
    expect(t).toContain(
      `current_user = DWeb.Auth.as_principal(%{id: "00000000-0000-0000-0000-000000000000", tenant_id: "beta", roles: []})`,
    );
    expect(t).toContain(`D.C.create_note(%{text: "acme only"}, current_user)`);
    expect(t).toContain(`case D.C.get_note(n.id, current_user) do`);
    expect(get(files, "lib/d_web/auth.ex")).toContain(
      "def as_principal(claims) when is_map(claims)",
    );
  });

  it("without auth no principal is bound (the test is unchanged)", async () => {
    const files = await generateSystemFiles(`
system P {
  subdomain S { context C {
    aggregate Note with crudish { text: string }
    repository Notes for Note { }
    test "a note reads back" {
      let n = Note.create(text: "hi")
      let r = Note.get(n.id)
      expect(r.text).toBe("hi")
    }
  } }
  api A from S
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable d { platform: node  contexts: [C]  dataSources: [st]  serves: A  port: 4000 }
}`);
    const t = get(files, "test/c.integration.test.ts");
    expect(t).not.toContain("runAsUser");
    expect(t).toContain(`it("a note reads back", async () => {`);
  });
});

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

// ---------------------------------------------------------------------------
// `test e2e … as { … }` (#3469): a block's principal travels as the dev-stub
// `x-loom-dev-claims` header of every request it sends, and an `as { … }` body
// line switches it for the requests after it — so a model-level test asserts
// a `requires` 403 and a `mask unless` redaction under a second principal.
// ---------------------------------------------------------------------------

const SRC = `
system H {
  user { id: guid  role: string  roles: string[] }
  subdomain S {
    context Desk {
      aggregate Ticket with crudish {
        title: string
        note: string mask unless currentUser.roles.contains("admin")
        status: string immutable
        operation close() requires currentUser.role == "agent" {
          status := "closed"
        }
      }
      repository Tickets for Ticket { }
    }
  }
  api A from S
  storage pg { type: postgres }
  resource st { for: Desk, kind: state, use: pg }
  deployable d { platform: node  contexts: [Desk]  dataSources: [st]  serves: A  port: 4000  auth: required }

  test e2e "an admin agent reads the note" against d as { role: "agent", roles: ["admin"] } {
    let t = api.tickets.create({ title: "printer", note: "pw", status: "open" })
    let r = api.tickets.getById(t)
    expect(r.note).toBe("pw")
  }

  test e2e "a viewer sees the note redacted and cannot close" against d as { role: "agent", roles: ["admin"] } {
    let t = api.tickets.create({ title: "printer", note: "pw", status: "open" })
    as { role: "viewer", roles: [] }
    let r = api.tickets.getById(t)
    expect(r.note).toBeNull()
    expect(api.tickets.close(t)).toThrow(403)
  }

  test e2e "the env principal" against d {
    let t = api.tickets.create({ title: "printer", note: "pw", status: "open" })
  }
}`;

const suite = async (src: string): Promise<string> => {
  const files = await generateSystemFiles(src);
  const hit = [...files.entries()].find(([p]) => p.endsWith(".e2e.test.ts"));
  if (!hit) throw new Error("no e2e suite emitted");
  return hit[1];
};

describe("e2e: per-block principal", () => {
  it("each block sets its principal before the reset; a body line switches it", async () => {
    const f = await suite(SRC);
    expect(f).toContain("let __principal: Record<string, unknown> | null = null;");
    expect(f).toContain(
      "const claims = __principal !== null ? JSON.stringify(__principal) : process.env.E2E_DEV_CLAIMS;",
    );
    const viewer = f.slice(f.indexOf("a viewer sees the note redacted"));
    expect(viewer).toContain(
      `__principal = { role: "agent", roles: ["admin"] };\n    await __resetState(base);`,
    );
    expect(viewer).toContain(`__principal = { role: "viewer", roles: [] };`);
    // The switch lands between the create and the read it governs.
    expect(viewer.indexOf("__post(`${base}/api/tickets`")).toBeLessThan(
      viewer.indexOf(`__principal = { role: "viewer"`),
    );
    expect(viewer.indexOf(`__principal = { role: "viewer"`)).toBeLessThan(
      viewer.indexOf("expect(r.note).toBeNull();"),
    );
    expect(viewer).toContain(".rejects.toThrow(/→ 403\\b/);");
    // A block with no clause falls back to the env principal.
    const env = f.slice(f.indexOf(`it("the env principal`));
    expect(env).toContain("__principal = null;");
  });

  it("a suite with no principal keeps the env-only header path", async () => {
    const f = await suite(
      SRC.replace(/ as \{ role: "agent", roles: \["admin"\] \}/g, "").replace(
        `    as { role: "viewer", roles: [] }\n`,
        "",
      ),
    );
    expect(f).not.toContain("__principal");
    expect(f).toContain("const claims = process.env.E2E_DEV_CLAIMS;");
  });
});

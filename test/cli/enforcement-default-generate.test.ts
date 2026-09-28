// M-T3.1 on the node leg, end to end through the real CLI: under the new
// language default an UNGATED route is never generated at all.
//
// `denyByDefault` is a compile-time posture, not a runtime filter — so the
// strongest statement about an ungated route under the default is not "it
// answers 403" but "no generated app serves it": `ddd generate system` refuses
// the model and writes nothing.  The same source with the codemod's
// `enforcement: opt` generates, and serves the route ungated (the pre-flip
// behaviour, kept); with a `requires` gate it generates under the default and
// the node route throws `ForbiddenError`, which the generated error handler
// maps to 403.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { pinEnforcementOpt } from "../../scripts/codemod-enforcement-opt.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, "..", "..", "bin", "cli.js");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loom-enforcement-default-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function model(gate: string): string {
  return `system Helpdesk {
  user { id: string role: string }
  auth {
    oidc { issuer: env("OIDC_ISSUER") clientId: env("OIDC_CLIENT_ID") }
  }
  subdomain S {
    context Tickets {
      aggregate Ticket {
        open: bool
        operation close() { ${gate}open := false }
      }
      repository Tickets for Ticket { }
    }
  }
  storage primary { type: postgres }
  resource st { for: Tickets, kind: state, use: primary }
  api SupportApi from S
  deployable api { platform: node contexts: [Tickets] serves: SupportApi dataSources: [st] port: 8080 auth: required }
}
`;
}

function generate(name: string, source: string): { status: number; out: string; dir: string } {
  const file = path.join(tmp, `${name}.ddd`);
  const dir = path.join(tmp, `${name}-out`);
  fs.writeFileSync(file, source);
  try {
    const out = execFileSync("node", [cli, "generate", "system", file, "-o", dir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, out, dir };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}`, dir };
  }
}

const routes = (dir: string): string =>
  fs.readFileSync(path.join(dir, "api", "http", "ticket.routes.ts"), "utf8");

describe("the enforcement default on the node leg (`ddd generate system`)", () => {
  it("refuses an ungated route under the DEFAULT and writes no app", () => {
    const r = generate("ungated-default", model(""));
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("loom.default-deny-ungated");
    expect(r.out).toContain("Ticket.close");
    expect(fs.existsSync(path.join(r.dir, "api"))).toBe(false);
  });

  it("generates the same model once the codemod pins `enforcement: opt` — route ungated", () => {
    const r = generate("ungated-opt", pinEnforcementOpt(model("")).text);
    expect(r.status, r.out).toBe(0);
    const src = routes(r.dir);
    expect(src).toContain(`path: "/{id}/close"`);
    expect(src).toContain("aggregate.close();");
    expect(src).not.toContain("throw new ForbiddenError");
  });

  it("generates a GATED route under the default, and the node route denies with 403", () => {
    const r = generate("gated-default", model('requires currentUser.role == "agent"\n        '));
    expect(r.status, r.out).toBe(0);
    expect(routes(r.dir)).toContain(
      'if (!(currentUser.role === "agent")) throw new ForbiddenError(',
    );
    // …and the generated handler maps that error to a 403 problem response.
    expect(routes(r.dir)).toContain('return problem(403, "Forbidden", err.message);');
  });
});

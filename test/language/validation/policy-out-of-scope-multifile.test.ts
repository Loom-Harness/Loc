// A function-form policy is context-local, and context names are unique across
// the workspace, so a policy declared in another FILE is always declared in
// another context.  Every way of reaching one must report
// `loom.policy-out-of-scope` — the typing pass types the call `bool` (a policy
// of that name exists in the unit), and lowering, finding no policy in the
// calling context to inline, emits a call to a function no backend defines:
// `if (!(IsAdmin())) throw new ForbiddenError(…)` in the generated Hono route,
// an undefined name in the generated authorization check.
//
// The arms: a `requires` gate called bare, qualified (`Orders.IsAdmin()`) and
// referenced without parentheses; a `mask unless`; a read ladder; a workflow's
// instance-read gate; a top-level function whose body calls the policy (it is
// inlined at the call site).  The same-file bare reference and the in-scope
// top-level function are the controls that keep the check from over-claiming.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { URI } from "langium";
import { NodeFileSystem } from "langium/node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDddServices } from "../../../src/language/ddd-module.js";
import { loadProject } from "../../../src/language/project-loader.js";
import { parseString } from "../../_helpers/parse.js";

const ORDERS = `subdomain Sales {
  context Orders {
    policy IsAdmin(): bool = currentUser.role == "admin"
    aggregate Order with crudish { n: int }
    repository RO for Order { }
  }
}
`;

/** `main.ddd` importing `orders.ddd`; `members` lands in context Fulfilment,
 *  `root` at file root. */
const main = (members: string, root = "") => `import "./orders.ddd"
${root}
system Shop {
  user { id: string  role: string }
  subdomain Ops {
    context Fulfilment {
      ${members}
      repository RS for Shipment { }
    }
  }
  storage s { type: postgres }
  resource st { for: Fulfilment, kind: state, use: s }
  deployable api { platform: node  contexts: [Fulfilment]  dataSources: [st]  port: 8080  auth: required }
}
`;

const shipment = (body: string) => `aggregate Shipment {
        label: string
        ${body}
      }`;

const OUT_OF_SCOPE =
  "policy 'IsAdmin' is declared in context 'Orders'; policies are context-local — " +
  "redeclare it in 'Fulfilment' to call it there.";

type Diag = { code: string; message: string };

describe("loom.policy-out-of-scope — a policy declared in another file", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loom-policy-xfile-"));
    fs.writeFileSync(path.join(tmp, "orders.ddd"), ORDERS);
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  /** Every error across the import closure, with its code. */
  async function errorsOf(mainSource: string): Promise<Diag[]> {
    fs.writeFileSync(path.join(tmp, "main.ddd"), mainSource);
    const services = createDddServices(NodeFileSystem);
    const { all } = await loadProject(URI.file(path.join(tmp, "main.ddd")), services.shared);
    return all.flatMap((d) =>
      (d.diagnostics ?? [])
        .filter((x) => x.severity === 1)
        .map((x) => ({
          code: String(x.code ?? ""),
          message: typeof x.message === "string" ? x.message : x.message.value,
        })),
    );
  }

  const arms: [string, string][] = [
    [
      "a `requires` gate calling it",
      shipment(`operation go() requires IsAdmin() { label := "x" }`),
    ],
    [
      "a `requires` gate calling it qualified",
      shipment(`operation go() requires Orders.IsAdmin() { label := "x" }`),
    ],
    [
      "a `requires` gate referencing it without parentheses",
      shipment(`operation go() requires IsAdmin { label := "x" }`),
    ],
    [
      "a `requires` gate composing it",
      shipment(`operation go() requires !IsAdmin() || label == "x" { label := "y" }`),
    ],
    ["a `mask unless`", shipment(`secret: string mask unless IsAdmin()`)],
    ["a read ladder", `policy { read Shipment requires IsAdmin() }\n      ${shipment("")}`],
    [
      "a workflow's instance-read gate",
      `workflow Ship requires IsAdmin() { create(label: string) { } }\n      ${shipment("")}`,
    ],
  ];

  for (const [arm, members] of arms) {
    it(`reports ${arm} — and nothing else`, async () => {
      expect(await errorsOf(main(members))).toEqual([
        { code: "loom.policy-out-of-scope", message: OUT_OF_SCOPE },
      ]);
    });
  }

  it("reports a top-level function whose body calls it, at the call site", async () => {
    const errors = await errorsOf(
      main(
        shipment(`operation go() requires adminish() { label := "x" }`),
        `function adminish(): bool = IsAdmin()`,
      ),
    );
    expect(errors).toEqual([
      {
        code: "loom.policy-out-of-scope",
        message:
          "function 'adminish' calls policy 'IsAdmin', which is declared in context 'Orders'; " +
          "policies are context-local and a top-level function is inlined where it is called — " +
          "redeclare 'IsAdmin' in 'Fulfilment' to call 'adminish' there.",
      },
    ]);
  });

  it("is silent when the calling context declares its own policy of that name", async () => {
    const errors = await errorsOf(
      main(
        `policy IsAdmin(): bool = currentUser.role == "root"\n      ${shipment(
          `secret: string mask unless IsAdmin\n        operation go() requires adminish() && IsAdmin() { label := "x" }`,
        )}`,
        `function adminish(): bool = IsAdmin()`,
      ),
    );
    expect(errors).toEqual([]);
  });
});

describe("loom.policy-out-of-scope — the same-file controls", () => {
  const twoContexts = (gate: string, root = "") => `
    ${root}
    system Shop {
      user { id: string  role: string }
      subdomain Sales {
        context Orders {
          policy IsAdmin(): bool = currentUser.role == "admin"
          aggregate Order { n: int  operation bump() requires ${gate} { n := n + 1 } }
        }
        context Billing {
          aggregate Invoice { n: int  operation bump() requires ${gate} { n := n + 1 } }
        }
      }
      storage s { type: postgres }
      resource st { for: Orders, kind: state, use: s }
      resource st2 { for: Billing, kind: state, use: s }
      deployable api { platform: node  contexts: [Orders, Billing]  dataSources: [st, st2]  port: 8080  auth: required }
    }
  `;

  it("reports the bare reference only from the context lacking the policy", async () => {
    const { errors } = await parseString(twoContexts("IsAdmin"));
    expect(errors).toEqual([
      expect.stringContaining(
        "policy 'IsAdmin' is declared in context 'Orders'; policies are context-local — redeclare it in 'Billing'",
      ),
    ]);
  });

  it("reports a top-level function only where it is called from the context lacking the policy", async () => {
    const { errors } = await parseString(
      twoContexts("adminish()", `function adminish(): bool = IsAdmin()`),
    );
    expect(errors).toEqual([expect.stringContaining("function 'adminish' calls policy 'IsAdmin'")]);
    expect(errors[0]).toContain("redeclare 'IsAdmin' in 'Billing'");
  });
});

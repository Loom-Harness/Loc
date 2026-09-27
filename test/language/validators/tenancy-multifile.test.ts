// `tenancy by user.<claim> of <Registry>` is a SYSTEM member, and top-level
// deployment members fold into the project's single system — so, exactly like
// `user { }` and `theme { }` (which `checkProjectSingletons` already resolves
// across the import graph), it may be written in any file of the project.
//
// `checkOrgPathReferences` scanned only the CURRENT document for it. The
// `tenantOwned` capability contributes a read filter over
// `currentUser.orgPath`, so every tenant-owned aggregate in an IMPORTED file
// reported:
//
//   model/dom.ddd:1:1 error: 'currentUser.orgPath' requires a
//     'tenancy by user.<claim> of <Registry>' declaration — … Add the tenancy
//     line, or drop the 'orgPath' reference.
//
// while `main.ddd`, one import away, declared exactly that. Generation was
// refused, and the line could not be moved into the imported file either —
// `tenancy` is not admitted at file root (`Expecting token of type 'EOF'`). So
// multi-file projects and multi-tenancy, both headline features, were mutually
// exclusive: every `tenantOwned` aggregate had to live in the same file as the
// `system` block.
//
// The check must stay FAIL-CLOSED when the project genuinely declares no
// tenancy — `currentUser.orgPath` would resolve to nothing at runtime — so the
// negative case is asserted here too, not just the positive one.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { URI } from "langium";
import { NodeFileSystem } from "langium/node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDddServices } from "../../../src/language/ddd-module.js";
import { loadProject } from "../../../src/language/project-loader.js";

function writeProject(rootDir: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(rootDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
  }
}

/** Every error-severity AST diagnostic across the whole import closure. */
async function projectErrors(entryDdd: string): Promise<string[]> {
  const services = createDddServices(NodeFileSystem);
  const { all } = await loadProject(URI.file(entryDdd), services.shared);
  return all.flatMap((d) =>
    (d.diagnostics ?? []).filter((x) => x.severity === 1).map((x) => x.message),
  );
}

/** The tenant-owned domain, always in an IMPORTED file. */
const DOMAIN = `
subdomain S {
  context C {
    aggregate Org with tenantRegistry, crudish {
      name: string
      derived display: string = name
    }
    aggregate Doc with tenantOwned, crudish { title: string }
    repository RO for Org { }
    repository RD for Doc { }
  }
}
`;

const main = (tenancyLine: string): string => `
import "./model/dom.ddd"
system T {
  user { id: guid, role: string, orgId: string }
${tenancyLine}
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api {
    platform: node
    contexts: [C]
    dataSources: [st]
    port: 3000
    auth: required
  }
}
`;

describe("`tenancy by` resolves across the import graph", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loom-tenancy-mf-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("a tenantOwned aggregate in an imported file sees the entry file's tenancy line", async () => {
    writeProject(tmp, {
      "model/dom.ddd": DOMAIN,
      "main.ddd": main("  tenancy by user.orgId of Org"),
    });
    const errors = await projectErrors(path.join(tmp, "main.ddd"));
    expect(
      errors,
      "the tenancy line is declared in main.ddd, one import away from the aggregate",
    ).toEqual([]);
  });

  it("stays fail-closed when the project declares no tenancy at all", async () => {
    writeProject(tmp, {
      "model/dom.ddd": DOMAIN,
      "main.ddd": main(""),
    });
    const errors = await projectErrors(path.join(tmp, "main.ddd"));
    // Vacuity guard on the positive test above: if this stopped erroring, the
    // first case would pass for the wrong reason.
    expect(
      errors.some((m) => m.includes("requires a 'tenancy by user.<claim> of <Registry>'")),
      `expected the orgPath-without-tenancy error, got: ${JSON.stringify(errors)}`,
    ).toBe(true);
  });
});

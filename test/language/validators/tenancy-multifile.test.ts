// `tenancy by` resolves across the import graph.  The line is a system member,
// and top-level deployment members fold into the project's single system, so it
// may be written in any file — a `tenantOwned` aggregate in an IMPORTED file
// must validate against the entry file's tenancy line, exactly like `user` /
// `theme`.  (`tenancy` is not admitted at file root, so it cannot move into the
// imported file instead.)

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
    (d.diagnostics ?? [])
      .filter((x) => x.severity === 1)
      // `Diagnostic.message` is `string | MarkupContent` in this LSP types
      // version, so it needs narrowing to land in a `string[]`.
      .map((x) => (typeof x.message === "string" ? x.message : x.message.value)),
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
});

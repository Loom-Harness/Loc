import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AstUtils, URI } from "langium";
import { NodeFileSystem } from "langium/node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDddServices } from "../../../src/language/ddd-module.js";
import {
  isBuilderCall,
  isPostfixChain,
  type Model,
  type PostfixChain,
} from "../../../src/language/generated/ast.js";
import { loadProject } from "../../../src/language/project-loader.js";
import { typingFor } from "../../../src/language/typing/shared.js";

// The project's `user { }` block folds into its single system wherever it is
// written (implicit-system-composition), so a `currentUser.<claim>` in one file
// must type against a claim block declared in ANOTHER.  The pass types per
// document; without the import-closure principal, `currentUser.permissions`
// in `hr.ddd` typed `unknown`, lowering fell back to the `string` placeholder,
// and .NET rendered `.Contains(x, StringComparison.Ordinal)` on a `List<string>`
// (web/src/examples/erp — `dotnet build` failed, CS1501).

const MAIN = `import "./money.ddd"
import "./hr.ddd"
system Erp {
  user {
    id: string
    permissions: string[]
  }
}
`;

const HR = `subdomain People {
  context Hr {
    aggregate Employee {
      title: string
      derived pay: Money = Money { amount: 1.0, currency: "USD" }
      operation promote() {
        requires currentUser.permissions.contains("people.manage")
        title := "lead"
      }
    }
  }
}
`;

// A root-level value object in a third file.  `Money` is also a walker
// primitive name, so before declarations resolved across the closure the
// builder in hr.ddd typed `slot` (erp's `order.addLine(…, Money { … }, …)`
// in a unit test then failed #3092's argument check).
const MONEY = `valueobject Money {
  amount: decimal
  currency: string
}
`;

describe("M-T5.44 — the principal resolves across the import closure", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loom-principal-"));
    fs.writeFileSync(path.join(tmp, "main.ddd"), MAIN);
    fs.writeFileSync(path.join(tmp, "hr.ddd"), HR);
    fs.writeFileSync(path.join(tmp, "money.ddd"), MONEY);
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("types `currentUser.permissions` in hr.ddd from main.ddd's `user { }`", async () => {
    const services = createDddServices(NodeFileSystem);
    const { all } = await loadProject(URI.file(path.join(tmp, "main.ddd")), services.shared);
    const hr = all.find((d) => d.uri.path.endsWith("/hr.ddd"));
    expect(hr, "hr.ddd loaded").toBeDefined();
    const chain = AstUtils.streamAllContents(hr!.parseResult.value as Model).find(
      (n): n is PostfixChain =>
        isPostfixChain(n) && (n.head as { name?: string }).name === "currentUser",
    );
    expect(chain, "the currentUser chain").toBeDefined();
    const permissions = chain!.suffixes[0]!;
    expect(typingFor(permissions).synthAt(permissions)).toMatchObject({
      kind: "array",
      element: { kind: "primitive", name: "string" },
    });
  });

  it("types a `Money { … }` builder in hr.ddd as money.ddd's value object", async () => {
    const services = createDddServices(NodeFileSystem);
    const { all } = await loadProject(URI.file(path.join(tmp, "main.ddd")), services.shared);
    const hr = all.find((d) => d.uri.path.endsWith("/hr.ddd"));
    const builder = AstUtils.streamAllContents(hr!.parseResult.value as Model).find(isBuilderCall);
    expect(builder, "the Money builder").toBeDefined();
    expect(typingFor(builder!).synthAt(builder!)).toMatchObject({
      kind: "valueobject",
      name: "Money",
    });
  });
});

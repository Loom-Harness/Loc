// An enum-typed `user {}` claim is spelled in `auth/User.java` (package
// `<base>.auth`) while the enum class lives in `<base>.domain.enums`, so the
// record must import it.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = `
system E {
  user { id: string  tier: Tier }
  subdomain S { context C {
    enum Tier { Gold, Silver }
    aggregate Note with crudish { body: string  operation pin() { requires currentUser.tier == Gold } }
    policy { read Note requires true }
    repository Notes for Note { }
  } }
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable api { platform: java, contexts: [C], dataSources: [st], port: 3000, auth: required }
}
`;

const NO_ENUM = SRC.replace("tier: Tier", "tier: string").replace("== Gold", '== "gold"');

describe("java auth — enum-typed user claim", () => {
  it("imports the enum package into auth/User.java", async () => {
    const files = await generateSystemFiles(SRC);
    const user = files.get("api/src/main/java/com/loom/api/auth/User.java")!;
    expect(user).toContain("public record User(String id, Tier tier,");
    expect(user).toContain("import com.loom.api.domain.enums.*;");
  });

  it("adds no enums import when no claim is enum-typed", async () => {
    const files = await generateSystemFiles(NO_ENUM);
    const user = files.get("api/src/main/java/com/loom/api/auth/User.java")!;
    expect(user).not.toContain("domain.enums");
  });
});

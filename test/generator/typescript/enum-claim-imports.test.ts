import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

// An enum-typed `user { … }` claim, gated on in an operation `requires`: the
// enum type is emitted into the domain tree, but the auth modules and the
// route file spell it, so each must import it; and the "no claim" values the
// auth modules fabricate must be assignable to the enum type.

const SRC = `
system E {
  user { id: string  tier: Tier }
  subdomain S {
    context C {
      enum Tier { Gold, Silver }
      aggregate Note with crudish {
        body: string
        operation pin() { requires currentUser.tier == Gold }
      }
      policy { read Note requires true }
      repository Notes for Note { find all(): Note paged }
    }
  }
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable api { platform: node, contexts: [C], dataSources: [st], port: 3000, auth: required }
}
`;

function file(files: Map<string, string>, suffix: string): string {
  const hit = [...files.entries()].find(([p]) => p.endsWith(suffix));
  if (!hit) throw new Error(`no emitted file ends with '${suffix}'`);
  return hit[1];
}

describe("enum-typed user claim (node)", () => {
  it("imports the enum where the claim shape and the requires gate spell it", async () => {
    const files = await generateSystemFiles(SRC);
    expect(file(files, "auth/user-types.ts")).toContain(
      'import type { Tier } from "../domain/value-objects";',
    );
    const routes = file(files, "http/note.routes.ts");
    expect(routes).toContain("Tier.Gold");
    expect(routes).toMatch(/import \{[^}]*\bTier\b[^}]*\} from "\.\.\/domain\/value-objects";/);
  });

  it("casts the empty enum claim to the claim type", async () => {
    const files = await generateSystemFiles(SRC);
    expect(file(files, "auth/dev-stub.ts")).toContain(
      'tier: null as unknown as UserClaims["tier"]',
    );
    expect(file(files, "auth/middleware.ts")).toContain(
      'tier: null as unknown as UserClaims["tier"]',
    );
  });
});

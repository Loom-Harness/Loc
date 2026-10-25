// A `currentUser.<claim>` read inside a ui page / component BODY, on the four
// JSX-family frontends (react, vue, svelte, angular).
//
// The shared walker core resolves a `current-user` member access through the
// `renderCurrentUserAccess` seam; a target that leaves the seam undefined falls
// through to the plain member emit, whose receiver is a `current-user` ref the
// `ref` arm cannot name — so the page shipped `/* unresolved: currentUser */
// undefined.role` while `ddd parse` reported nothing.  Each JSX target now
// renders the access against the session user its page / component shell
// already binds for currentUser-gated `Action` buttons and page `requires`
// gates, and entering the seam sets `usesCurrentUser`, which is what makes the
// shell emit that binding.  Value positions (template interpolation, `match`,
// ternary, `Stat`) all ride the same seam, so they are asserted together.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const source = (platform: string) => `
system Cu {
  user { id: string  role: string }
  subdomain S { context C {
    aggregate Note with crudish { body: string }
    repository Notes for Note { find all(): Note paged requires true }
  } }
  ui Web {
    component Greeting(label: string) {
      body: Text("Hi " + currentUser.role + " " + label)
    }
    page Home {
      route: "/"
      body: Stack {
        Text(currentUser.role),
        Text(match {
          currentUser.role == "admin" => "boss"
          else => "peon"
        }),
        Text(currentUser.id == "u1" ? "A" : "B"),
        Stat("Role", currentUser.role),
        Greeting(label: "x")
      }
    }
  }
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable api { platform: node, contexts: [C], dataSources: [st], port: 3000, auth: required }
  deployable web { platform: ${platform}, targets: api, ui: Web, port: 3001, auth: ui }
}
`;

function find(files: Map<string, string>, suffix: string): string {
  for (const [k, v] of files) if (k.endsWith(suffix)) return v;
  throw new Error(`no file ending ${suffix}`);
}

/** Per framework: the page + component files, the session binding each shell
 *  emits, and the spelling of the claim access the seam renders. */
const CASES = [
  {
    platform: "react",
    page: "web/src/pages/home.tsx",
    component: "web/src/components/Greeting.tsx",
    binding: "const currentUser = useSession().user as Record<string, any>;",
    access: "currentUser.",
  },
  {
    platform: "vue",
    page: "web/src/pages/home.vue",
    component: "web/src/components/Greeting.vue",
    binding: "const currentUser = (useSession().user.value ?? {}) as Record<string, any>;",
    access: "currentUser.",
  },
  {
    platform: "svelte",
    page: "web/src/routes/(app)/+page.svelte",
    component: "web/src/lib/components/Greeting.svelte",
    binding: "const currentUser = useSession().user as Record<string, any>;",
    access: "currentUser.",
  },
  {
    platform: "angular",
    page: "web/src/app/pages/home.component.ts",
    component: "web/src/app/components/Greeting.ts",
    binding: "get currentUser(): Record<string, any> { return this.session.user() ?? {}; }",
    access: "this.currentUser.",
  },
] as const;

describe("currentUser.<claim> read in a ui body — JSX-family frontends", () => {
  for (const c of CASES) {
    it(`${c.platform}: page body resolves the claim against the bound session user`, async () => {
      const files = await generateSystemFiles(source(c.platform));
      const page = find(files, c.page);
      expect(page, `${c.platform} page still carries the unresolved sentinel`).not.toContain(
        "unresolved: currentUser",
      );
      expect(page).toContain(c.binding);
      // The binding is emitted once even with several reads.
      expect(page.split(c.binding).length - 1).toBe(1);
      // Plain read (Text child and Stat value) …
      expect(page).toContain(`${c.access}role`);
      // … a `match` value (folded to a ternary) …
      expect(page).toContain(`(${c.access}role === "admin") ? "boss" : "peon"`);
      // … and an explicit ternary.
      expect(page).toContain(`(${c.access}id === "u1") ? "A" : "B"`);
    });

    it(`${c.platform}: component body resolves the claim and binds the session user`, async () => {
      const files = await generateSystemFiles(source(c.platform));
      const component = find(files, c.component);
      expect(component).not.toContain("unresolved: currentUser");
      expect(component).toContain(c.binding);
      expect(component).toContain(`role: ${c.access}role`);
    });
  }

  it("still refuses a currentUser body read on a frontend without auth: ui", async () => {
    await expect(
      generateSystemFiles(source("react").replace(", auth: ui }", " }")),
    ).rejects.toThrow("loom.current-user-needs-auth-ui");
  });
});

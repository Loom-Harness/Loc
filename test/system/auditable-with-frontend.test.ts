import { describe, expect, it } from "vitest";
import { validate } from "../../src/api/index.js";
import { generateSystemFiles } from "../_helpers/generate.js";

// ---------------------------------------------------------------------------
// The built-in `auditable` capability paired with a FRONTEND.
//
// `auditable` stamps `createdBy`/`updatedBy: User id`, where `User` is the
// authentication PRINCIPAL (src/util/principal.ts) — it has no `aggregate
// User` declaration and never will.  Every consumer that assumes an `id`
// target names a domain aggregate misread it, and nothing caught that because
// every checked-in example pairing `auditable` with a frontend had to work
// around it first.  This file is the pairing that was missing:
//
//   1. a UI-mounting deployable must not demand an `aggregate User` (the
//      picker checks in react-id-reference-checks.ts fired for ALL SIX
//      frontends, not just react — they gate on `mountsUi`, not on the
//      framework name);
//   2. the scaffold must not link the stamped field to `/users/<id>`, a route
//      nothing registers;
//   3. a real `aggregate User` must still get the ordinary picker treatment,
//      so the narrowing above cannot silently disable the checks;
//   4. and `auditable` with no `user {}` block at all — no principal to stamp
//      FROM — must still be rejected, naming the principal as the fix.
// ---------------------------------------------------------------------------

/** The six UI frameworks whose deployables mount a scaffolded UI. */
const FRONTENDS = ["react", "vue", "svelte", "angular", "feliz", "flutter"] as const;

/** `auditable` + a scaffolded frontend, with the principal properly declared.
 *  The minimal shape the audit's repro was missing. */
const WITH_PRINCIPAL = (platform: string) => `
system AuditUi {
  user { id: string  email: string }
  subdomain Shop { context Shop {
    aggregate Widget with crudish, auditable { code: string }
    repository Widgets for Widget { }
  } }
  ui Console with scaffold(subdomains: [Shop]) { }
  api ShopApi from Shop
  storage primary { type: postgres }
  resource shopState { for: Shop, kind: state, use: primary }
  deployable api { platform: node  contexts: [Shop]  dataSources: [shopState]  serves: ShopApi  port: 3000  auth: required }
  deployable web { platform: ${platform}  targets: api  ui: Console  port: 3001 }
}
`;

/** The same system with NO `user {}` block — `createdBy := currentUser` with
 *  no principal in the model at all. */
const NO_PRINCIPAL = `
system AuditUi {
  subdomain Shop { context Shop {
    aggregate Widget with crudish, auditable { code: string }
    repository Widgets for Widget { }
  } }
  ui Console with scaffold(subdomains: [Shop]) { }
  api ShopApi from Shop
  storage primary { type: postgres }
  resource shopState { for: Shop, kind: state, use: primary }
  deployable api { platform: node  contexts: [Shop]  dataSources: [shopState]  serves: ShopApi  port: 3000 }
  deployable web { platform: react  targets: api  ui: Console  port: 3001 }
}
`;

/** A model that really DOES declare `aggregate User` — but without the
 *  `derived display` a Select picker needs.  The principal narrowing keys on
 *  the name being unclaimed, so this must still raise the picker diagnostic. */
const REAL_USER_AGGREGATE = `
system Refs {
  subdomain Shop { context Shop {
    aggregate User with crudish { email: string }
    aggregate Widget with crudish { code: string  owner: User id }
    repository Widgets for Widget { }
    repository Users for User { }
  } }
  ui Console with scaffold(subdomains: [Shop]) { }
  api ShopApi from Shop
  storage primary { type: postgres }
  resource shopState { for: Shop, kind: state, use: primary }
  deployable api { platform: node  contexts: [Shop]  dataSources: [shopState]  serves: ShopApi  port: 3000 }
  deployable web { platform: react  targets: api  ui: Console  port: 3001 }
}
`;

async function errorsOf(source: string): Promise<{ code?: string; message: string }[]> {
  const report = await validate(source);
  return report.diagnostics
    .filter((d) => d.severity === "error")
    .map((d) => ({ code: d.code, message: d.message }));
}

describe("`auditable` + a frontend — the principal is not a domain aggregate", () => {
  it.each(
    FRONTENDS,
  )("%s: a principal-stamped aggregate does not demand an `aggregate User`", async (platform) => {
    const errors = await errorsOf(WITH_PRINCIPAL(platform));
    // The whole family, not just the code the audit reported: all three
    // picker invariants are preconditions for a `<Select>` the principal
    // field never renders as.
    expect(errors.filter((e) => e.code?.startsWith("loom.ui-id-ref-"))).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("the scaffold renders the stamped identity as read-only text, not a link to `/users/<id>`", async () => {
    const files = await generateSystemFiles(WITH_PRINCIPAL("react"));
    const detail = files.get("web/src/pages/widgets/detail.tsx")!;
    const list = files.get("web/src/pages/widgets/list.tsx")!;
    expect(detail).toBeDefined();
    expect(list).toBeDefined();

    // No route is ever registered for the principal, so any link to one is
    // dead on arrival.  Assert over the WHOLE emitted frontend, not just the
    // two pages, so a new emit site cannot reintroduce it.
    for (const [path, content] of files) {
      if (!path.startsWith("web/")) continue;
      expect(content, `${path} links to a /users/ route nothing serves`).not.toContain("/users/");
    }

    // What it renders as instead: the stamped value, read-only.
    expect(detail).toContain("<Text>{widgetById.data.createdBy}</Text>");
    expect(detail).toContain("<Text>{widgetById.data.updatedBy}</Text>");
    expect(list).toContain("<Text>{row.createdBy}</Text>");
  });

  it("the stamped fields stay out of the create form — they are `managed`, not inputs", async () => {
    const files = await generateSystemFiles(WITH_PRINCIPAL("react"));
    const create = files.get("web/src/pages/widgets/new.tsx")!;
    expect(create).toContain('register("code")');
    for (const managed of ["createdBy", "updatedBy", "createdAt", "updatedAt"]) {
      expect(create, `\`${managed}\` is a managed stamp, never a form input`).not.toContain(
        `register("${managed}")`,
      );
    }
  });

  it("a HAND-WRITTEN `User id` with no principal is still rejected, by the linker", async () => {
    // The narrowing must not become a way to smuggle a dangling reference
    // through.  It cannot: only a MACRO-emitted ref reaches the IR unresolved
    // (a synthesized ref carries no `$refNode`, so Langium's Linker skips it
    // silently — `lowerBase`'s comment), and the macro that emits one is
    // `auditable`, whose principal stamp the guard below rejects.  A ref the
    // author actually typed fails to link first, whatever this check does.
    const errors = await errorsOf(`
system HandWritten {
  subdomain Shop { context Shop {
    aggregate Widget with crudish { code: string  owner: User id }
    repository Widgets for Widget { }
  } }
  ui Console with scaffold(subdomains: [Shop]) { }
  api ShopApi from Shop
  storage primary { type: postgres }
  resource shopState { for: Shop, kind: state, use: primary }
  deployable api { platform: node  contexts: [Shop]  dataSources: [shopState]  serves: ShopApi  port: 3000 }
  deployable web { platform: react  targets: api  ui: Console  port: 3001 }
}
`);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => /Could not resolve reference.*User/.test(e.message))).toBe(true);
  });

  it("a real `aggregate User` still gets the ordinary picker treatment", async () => {
    // The narrowing keys on the principal name being UNCLAIMED.  A model that
    // declares the aggregate resolves the reference to it, so the picker
    // precondition (a `derived display` to label options with) still applies —
    // otherwise this fix would quietly switch the checks off for every model
    // that happens to name an aggregate `User`.
    const errors = await errorsOf(REAL_USER_AGGREGATE);
    expect(errors.map((e) => e.code)).toContain("loom.ui-id-ref-no-display");
  });
});

describe("`auditable` with no principal declared at all", () => {
  it("is rejected, and names the principal rather than a missing aggregate", async () => {
    const errors = await errorsOf(NO_PRINCIPAL);
    const codes = errors.map((e) => e.code);

    // The rule that owns this: there is no request-scoped principal to stamp
    // from.  It was silently missed because the unresolved `currentUser` ref
    // lowers to `refKind: "unknown"` when no `user {}` block exists, so the
    // resolved-only matcher returned false — the model emitted a Hono backend
    // referencing an undefined `currentUser` and a phantom `Ids.UserId`.
    expect(codes).toContain("loom.stamp-principal-without-auth");

    // And NOT the diagnostic that sent authors off to declare a CRUD
    // aggregate for their authentication principal.
    expect(codes).not.toContain("loom.ui-id-ref-unknown-aggregate");
  });

  it("stays rejected on a backend-only deployable — the UI was never the problem", async () => {
    const backendOnly = NO_PRINCIPAL.replace(
      / {2}ui Console[^\n]*\n| {2}deployable web[^\n]*\n/g,
      "",
    ).replace("  ui: Console", "");
    const codes = (await errorsOf(backendOnly)).map((e) => e.code);
    expect(codes).toContain("loom.stamp-principal-without-auth");
  });
});

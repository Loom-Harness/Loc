// The client half of the optimistic-concurrency precondition — which frontends
// actually send `If-Match`.
//
// F-023: `grep -rn 'If-Match' web/src` over a generated project returned NOTHING
// on every frontend, while all five backends read the header and guard the
// `versioned` update on it.  With the header never on the wire,
// `parseIfMatch(undefined, current)` fell back to the version the server had
// just loaded itself — so the guard ran, matched by construction, and caught
// nothing a user could cause.  A lost update (two people open the same record,
// both save, the second silently overwrites) is exactly the case it exists for,
// and `docs/language.md` promises a `token` field is "sent as an
// optimistic-concurrency precondition".
//
// The gate is a per-frontend TABLE rather than one sweep, for the same reason
// the backend grammar gate is: the six frontends call the API in six idioms,
// and a generic "does the emitted text contain If-Match" matcher would pass on
// a frontend that merely mentions it in a comment.  Each row names the file and
// the exact call shape.
//
// SENDING and NOT-SENDING are both pinned.  A frontend that does not yet send
// it is listed with the reason, so this is a ratchet: closing one means moving
// its row, not editing an assertion.
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const backend = `
  storage p { type: postgres }
  resource r { for: C, kind: state, use: p }
  api CApi from S
  deployable api { platform: node, contexts: [C], dataSources: [r], serves: CApi, port: 3000 }
`;

const model = (framework: string) => `
system OccDemo {
  subdomain S {
    context C {
      aggregate Doc with crudish, versioned {
        title: string
        body: string
      }
      repository Docs for Doc { }
    }
  }
${backend}
  ui Web with scaffold(subdomains: [S]) {
    framework: ${framework}
    api S: CApi
  }
  deployable web { platform: static, targets: api, ui: Web { S: api }, port: 3001 }
}
`;

/** Frontends that send the precondition, and the emitted call that proves it. */
const SENDS: Record<string, { file: RegExp; call: RegExp }> = {
  react: {
    file: /src\/api\/doc\.ts$/,
    call: /api\.post\(`\/docs\/\$\{seg\(id\)\}\/update`, input, ifMatch\(loaded\?\.version\)\)/,
  },
  vue: {
    file: /src\/api\/doc\.ts$/,
    call: /api\.post\(`\/docs\/\$\{seg\(id\)\}\/update`, input, ifMatch\(loaded\?\.version\)\)/,
  },
  svelte: {
    file: /api\/doc\.ts$/,
    call: /api\.post\(`\/docs\/\$\{seg\(id\(\)\)\}\/update`, input, ifMatch\(loaded\?\.version\)\)/,
  },
  angular: {
    file: /src\/api\/doc\.ts$/,
    call: /service\.update\(vars\.id, vars\.input, ifMatch\(/,
  },
};

describe("If-Match: the generated client sends the precondition it promises", () => {
  it.each(Object.keys(SENDS))("%s", async (framework) => {
    const files = await generateSystemFiles(model(framework));
    const { file, call } = SENDS[framework]!;
    const matching = [...files].filter(([p]) => file.test(p));
    expect(
      matching.map(([p]) => p),
      `${framework}: no api module matched ${file}`,
    ).not.toEqual([]);
    expect(
      matching.some(([, t]) => call.test(t)),
      `${framework}: the update call carries no If-Match precondition`,
    ).toBe(true);
  }, 90_000);

  it("the precondition rides the guarded write only", async () => {
    // The backends guard `update` on a `versioned` aggregate and nothing else
    // (`isVersionedUpdate`).  A client that preconditioned every operation would
    // change .NET's behaviour — it reads If-Match in request-context middleware,
    // so the header would guard writes the other four leave unguarded.
    const files = await generateSystemFiles(
      model("react").replace(
        "        body: string\n",
        "        body: string\n        operation touch() { title := title }\n",
      ),
    );
    const mod = [...files].find(([p]) => /src\/api\/doc\.ts$/.test(p))![1];
    expect(mod).toMatch(/\/touch`, input\);/);
    expect(mod).toMatch(/\/update`, input, ifMatch\(/);
  }, 90_000);

  it("the entity-tag is quoted, and the helper ships with the shared client", async () => {
    // An unquoted `If-Match: 3` is not an entity-tag, and java now parses the
    // quoted form precisely because this is what the client sends — the two
    // halves of F-023 have to agree on one spelling or the fix is worse than
    // the gap.
    const files = await generateSystemFiles(model("react"));
    const client = [...files].find(([p]) => /src\/api\/client\.ts$/.test(p))![1];
    // `ifMatch` lives in the shared client for every frontend, versioned or not.
    expect(client).toMatch(/export const ifMatch = \(/);
    expect(client, "the entity-tag must be QUOTED (RFC 9110 §8.8.3)").toMatch(
      /\{ "If-Match": `"\$\{version\}"` \}/,
    );
  }, 90_000);
});

// ---------------------------------------------------------------------------
// The residual, pinned by name.
//
// Feliz (F#/Elmish) and Flutter (Dart) do NOT ride the shared api module: each
// builds its own HTTP calls, and neither keeps the loaded record in a query
// cache the mutation can read — the Elmish `update` loop and Flutter's
// `http.post(apiUri(...))` call sites take the route `id` and nothing else.
// Wiring the precondition there means threading the loaded record through the
// form seam, which is a larger change than this one and belongs with whoever
// owns those emitters.
//
// Listed rather than silently skipped: a frontend that does not send the
// precondition has a silent lost update, so the gap is a tracked number.
// ---------------------------------------------------------------------------
const DOES_NOT_SEND: Record<string, string> = {
  feliz:
    "Elmish: no query cache; the POST Cmd is built in `update` from the route id alone " +
    "(`feliz/wire.ts` opPath). Needs the loaded record threaded through the form seam.",
  flutter:
    "Dart: `http.post(apiUri('/docs/$id/update'))` is built at the call site " +
    "(`flutter/forms-emit.ts`, `riverpod-emit.ts`); the row is not in scope there.",
};

describe("If-Match: frontends that do not send it yet", () => {
  it("is a closed, named list", () => {
    expect(Object.keys(DOES_NOT_SEND).sort()).toEqual(["feliz", "flutter"]);
    for (const [fw, why] of Object.entries(DOES_NOT_SEND)) {
      expect(why.length, `${fw}: a waiver needs a reason`).toBeGreaterThan(40);
    }
  });
});

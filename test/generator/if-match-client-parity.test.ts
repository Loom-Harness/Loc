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
    call: /api\.post\(`\/docs\/\$\{seg\(toValue\(id\)\)\}\/update`, input, ifMatch\(loaded\?\.version\)\)/,
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

  it.each(
    Object.keys(SENDS),
  )("%s: the emitted client EXPORTS the helper its api modules import", async (framework) => {
    // The gate this file was missing, and CI found for me: `ifMatch` was added
    // to `api/api-client.hbs` — which react, vue and angular render — while
    // SVELTEKIT KEEPS ITS OWN COPY (`sveltekit/api-client.hbs`).  So svelte
    // emitted modules importing a symbol its own client did not export, and 12
    // of 14 `generated-svelte-build` shards failed on
    // `Module './client' has no exported member 'ifMatch'`.
    //
    // Asserting the CALL SITE (above) could never catch that: the call was
    // emitted correctly.  The defect is the seam between two files, so the
    // assertion has to span it — per frontend, because which template a host
    // renders is exactly the fact that varies.
    const files = await generateSystemFiles(model(framework));
    const importers = [...files].filter(([, t]) =>
      /import \{[^}]*\bifMatch\b[^}]*\} from "\.\/client"/.test(t),
    );
    expect(
      importers.map(([p]) => p),
      `${framework}: nothing imports ifMatch`,
    ).not.toEqual([]);
    const client = [...files].find(([p]) => /(^|\/)client\.ts$/.test(p));
    expect(client, `${framework}: no client module emitted`).toBeDefined();
    expect(
      client![1],
      `${framework}: ${importers.length} module(s) import ifMatch but the emitted ` +
        `client does not export it — this host renders a DIFFERENT api-client template`,
    ).toMatch(/export const ifMatch\b/);
    // The `headers` parameter the call site passes has to exist too: an
    // exported helper whose value nothing accepts is the same defect one
    // argument along (`Expected 2 arguments, but got 3`).
    expect(client![1], `${framework}: api.post takes no headers argument`).toMatch(
      /post: \(path: string, body: unknown, headers\?: Record<string, string>\)/,
    );
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
// The two self-hosted frontends (#27).
//
// Feliz (F#/Elmish) and Flutter (Dart) do NOT ride the shared api module: each
// builds its own HTTP calls, and neither keeps a query cache the mutation can
// read.  They used to be a named `DOES_NOT_SEND` waiver here — a silent lost
// update on every `versioned` aggregate they edited.  Each now threads the
// loaded record's version to the call site, so the rows below pin BOTH halves:
// the api call that quotes it into the header, and the call site that supplies
// the version of the record the page actually loaded (a header built from a
// version nobody passes is the vacuous guard again, one hop along).
// ---------------------------------------------------------------------------

const selfHosted = (platform: "feliz" | "flutter") => `
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
  ui Web with scaffold(subdomains: [S]) { }
  deployable web { platform: ${platform}, targets: api, ui: Web, port: 3001 }
}
`;

describe("If-Match: the self-hosted frontends send the loaded version", () => {
  it("feliz: the update api fn quotes the version, and the submit arm passes the loaded one", async () => {
    const files = await generateSystemFiles(selfHosted("feliz"));
    const app = [...files].find(([p]) => p.endsWith("src/App.fs"))![1];
    expect(app).toContain(
      "let updateDoc (id: string) (ifMatch: string option) (form: UpdateDocOpForm)",
    );
    expect(app, "the entity-tag must be QUOTED (RFC 9110 §8.8.3)").toContain(
      '|> (fun req -> match ifMatch with | Some v -> req |> Http.header (Headers.create "If-Match" (sprintf "\\"%s\\"" v)) | None -> req)',
    );
    // The version comes from the Model's byId read, and only when it is the
    // record the route id addresses.
    expect(app).toContain(
      "  | SubmitUpdateDocOpForm id -> model, Cmd.OfAsync.perform (Api.updateDoc id (match model.DocById with | Loaded (Some __loaded) when __loaded.id = id -> Some (string __loaded.version) | _ -> None)) model.UpdateDocOpForm UpdateDocOpDone",
    );
  }, 90_000);

  it("flutter: the update form sends If-Match, and the detail page hands it the loaded version", async () => {
    const files = await generateSystemFiles(selfHosted("flutter"));
    const forms = [...files].find(([p]) => p.endsWith("lib/forms.dart"))![1];
    expect(forms).toContain("  final int? expectedVersion;");
    expect(forms).toContain(
      "const UpdateDocForm({super.key, required this.id, this.expectedVersion});",
    );
    expect(forms, "the entity-tag must be QUOTED (RFC 9110 §8.8.3)").toContain(
      "headers: {'Content-Type': 'application/json', if (widget.expectedVersion != null) 'If-Match': '\"${widget.expectedVersion}\"'},",
    );
    const detail = [...files].find(([p]) => p.endsWith("lib/pages/doc_detail_page.dart"))![1];
    expect(detail).toContain("UpdateDocForm(id: id, expectedVersion: docById.version)");
  }, 90_000);

  it("the precondition rides the guarded write only (self-hosted)", async () => {
    // Same rule as the JS clients: only `update` is preconditioned — .NET
    // would otherwise guard writes the other four backends leave unguarded.
    const withRename = (p: "feliz" | "flutter") =>
      selfHosted(p).replace(
        "        body: string\n",
        "        body: string\n        operation rename(t: string) { title := t }\n",
      );
    const feliz = await generateSystemFiles(withRename("feliz"));
    const app = [...feliz].find(([p]) => p.endsWith("src/App.fs"))![1];
    expect(app).toContain("let renameDoc (id: string) (form: RenameDocOpForm)");
    expect(app).toContain("(Api.renameDoc id) model.RenameDocOpForm");
    const flutter = await generateSystemFiles(withRename("flutter"));
    const forms = [...flutter].find(([p]) => p.endsWith("lib/forms.dart"))![1];
    expect(forms).toContain("const RenameDocForm({super.key, required this.id});");
    const detail = [...flutter].find(([p]) => p.endsWith("lib/pages/doc_detail_page.dart"))![1];
    expect(detail).toContain("RenameDocForm(id: id)");
  }, 90_000);
});

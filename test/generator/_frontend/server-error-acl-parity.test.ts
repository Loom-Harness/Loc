// The frontend ACL — "a 422's per-field errors land on the form field they
// name" — across all six frontends (M-T9.20's "frontend ACL" parity row).
//
// `react/frontend-acl-emit.test.ts` pins React's `applyServerErrors` by
// EXECUTING it against synthetic ProblemDetails.  No other frontend had an
// equivalent, and the synthetic input is the weakness: a mapper written against
// the test author's idea of the wire passes a test written against the same
// idea.  So this gate takes its input from OUTSIDE both the emitter and the
// test (rule 12 of the completion plan): the 422 body a BOOTED backend actually
// returned, recorded in the behavioural tier's wire golden
// (`test/behavioral/wire-golden/absent-optional.json`, verified against all
// seven legs).  Each target's emitted error mapper is transpiled and executed
// against that body, wrapped in the `ApiError` the target's own generated
// client throws, and must land the error on the form field the `pointer`
// names.
//
// The four TypeScript targets (React, Vue, Svelte, Angular) are EXECUTED; the
// F# (Feliz) and Dart (Flutter) mappers cannot run here, so their decode →
// Model → field chain is pinned statically, and each decoder was run against
// the same golden body through its own toolchain (Fable / `dart run`) when it
// was written.  A target that regresses goes back on WAIVERS with the defect
// it records; a waiver ratchets exactly like the slot-coverage gate's — a
// waived target must STILL fail, so the fix that lands without deleting its
// line fails here.

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

// --- the oracle: a 422 a booted backend returned -----------------------------

interface WireEntry {
  status: number;
  path: string;
  body: { errors?: { pointer: string; message: string; code?: string }[] } & Record<
    string,
    unknown
  >;
}

const GOLDEN = JSON.parse(
  fs.readFileSync(
    path.resolve(import.meta.dirname, "../../behavioral/wire-golden/absent-optional.json"),
    "utf8",
  ),
) as { entries: WireEntry[] };

const REJECTION = GOLDEN.entries.find(
  (e) => e.status === 422 && (e.body.errors?.some((x) => x.pointer) ?? false),
);
const FIELD_ERROR = REJECTION?.body.errors?.[0];

// The same aggregate the golden was recorded from — `absent-optional.ddd` —
// fronted by a CreateForm, so the pointer names a real form field.
const DOMAIN = `
  subdomain Work {
    context Tracker {
      aggregate Ticket with crudish {
        title: string
        estimate: int?
        invariant estimate == null || estimate >= 0 message "Estimate cannot be negative"
      }
      repository Tickets for Ticket { }
    }
  }
  api WorkApi from Work`;

// --- targets -----------------------------------------------------------------

type Mapper = (error: unknown) => Record<string, string>;

interface Target {
  readonly id: string;
  readonly platform: string;
  readonly design?: string;
  readonly framework?: string;
  /** Build the executable mapper from the emitted tree — undefined when the
   *  target emits none (then only a waiver can pass it). */
  readonly load?: (files: ReadonlyMap<string, string>) => {
    map: Mapper;
    ApiError: new (status: number, message: string, body?: unknown) => unknown;
  };
  /** For a target whose mapper is a free function the FORM must call and
   *  render (rather than a form runtime that owns both), assert the emitted
   *  CreateForm does both for `field`. */
  readonly wired?: (files: ReadonlyMap<string, string>, field: string) => void;
  /** For a target whose mapper is not TypeScript (F#, Dart) and so cannot run
   *  here: assert the emitted decode → Model → field chain for `field`. */
  readonly statically?: (files: ReadonlyMap<string, string>, field: string) => void;
}

const TARGETS: readonly Target[] = [
  {
    id: "react",
    platform: "react",
    design: "mantine",
    load: (files) => {
      const fn = evalModule(file(files, "web/src/lib/apply-server-errors.ts"), "applyServerErrors");
      return {
        ApiError: apiErrorOf(files, "web/src/api/client.ts"),
        map: (error) => {
          const out: Record<string, string> = {};
          (fn as (a: unknown) => unknown)({
            error,
            setError: (f: string, o: { message: string }) => {
              out[f] = o.message;
            },
            fieldMap: {},
          });
          return out;
        },
      };
    },
  },
  {
    id: "vue",
    platform: "vue",
    design: "vuetify",
    load: (files) => {
      const src = file(files, "web/src/lib/form.ts");
      const fn = evalModule(
        `export ${sliceBlock(src, "function applyServerError(")}\n${sliceBlock(src, "function pointerToPath(")}`,
        "applyServerError",
      );
      return {
        ApiError: apiErrorOf(files, "web/src/api/client.ts"),
        map: (error) => {
          const out: Record<string, string> = {};
          (fn as (e: unknown, s: (p: string, m: string) => void) => void)(error, (p, m) => {
            out[p] = m;
          });
          return out;
        },
      };
    },
  },
  {
    id: "svelte",
    platform: "svelte",
    design: "flowbite",
    load: (files) => {
      const src = file(files, "web/src/lib/forms.svelte.ts");
      const ApiErrorSrc = sliceBlock(
        file(files, "web/src/lib/api/client.ts"),
        "export class ApiError",
      );
      // The mapper is a method of the form object, closing over the form's
      // `errors` rune state; rebuild exactly that closure around it.  The
      // mapper tests `instanceof ApiError`, so the error is built from the
      // SAME class instance the mapper's module sees.
      const mod = `${ApiErrorSrc}
let errors: Record<string, string> = {};
${sliceBlock(src, "function pointerToPath(")}
const form = { ${sliceBlock(src, "applyServerErrors(e: unknown) {")} };
function run(e: unknown) { errors = {}; form.applyServerErrors(e); return errors; }
export const loaded = { ApiError, run };`;
      const { ApiError, run } = evalModule(mod, "loaded") as {
        ApiError: never;
        run: (e: unknown) => Record<string, string>;
      };
      return { ApiError, map: run };
    },
  },
  {
    id: "angular",
    platform: "angular",
    design: "primeng",
    load: (files) => {
      const fn = evalModule(file(files, "web/src/lib/server-errors.ts"), "applyServerErrors");
      return {
        ApiError: apiErrorOf(files, "web/src/api/client.ts"),
        // A Reactive `FormGroup` reduced to what the mapper touches: one control
        // per field the CreateForm renders, recording the `server` error it is
        // given.  The control set is read off the emitted component, so a
        // pointer naming a field the form does not render finds no control.
        map: (error) => {
          const out: Record<string, string> = {};
          const fields = angularFormControls(files);
          const form = {
            get: (path: string) =>
              fields.has(path)
                ? {
                    setErrors: (e: { server: string }) => {
                      out[path] = e.server;
                    },
                    markAsTouched: () => {},
                  }
                : null,
          };
          const outcome = (fn as (e: unknown, f: unknown) => { kind: string; title?: string })(
            error,
            form,
          );
          if (outcome.kind === "global") out.__global = outcome.title!;
          return out;
        },
      };
    },
    wired: (files, field) => {
      const component = angularFormComponent(files);
      expect(component, "the CreateForm submit must hand a rejection to the mapper").toMatch(
        /catch \(e\) \{\s*placeServerErrors\(e, this\.\w+\);/,
      );
      expect(component, `the "${field}" field must render its server message`).toContain(
        `.controls.${field}.errors?.['server']`,
      );
    },
  },
  {
    id: "feliz",
    platform: "feliz",
    framework: "feliz",
    // F# — not executable here.  The decoder pinned below was Fable-compiled
    // and run against this same golden body (it files the message under
    // "estimate"); this pins every link of the chain that probe rests on.
    statically: (files, field) => {
      const app = file(files, "web/src/App.fs");
      expect(app, "the create fn must decode a rejection, not drop its body").toMatch(
        /let createTicket [^\n]*Result<string, ServerErrors>>[\s\S]*?return Error \(ServerErrors\.ofResponse response\.statusCode response\.responseText\)/,
      );
      expect(app, "the decoder must read the errors[] ARRAY").toContain(
        'Decode.fromString (Decode.field "errors" (Decode.list entry)) body',
      );
      expect(app).toContain(
        'get.Optional.Field "pointer" Decode.string |> Option.defaultValue ""), get.Required.Field "message" Decode.string',
      );
      expect(app, "a rejected create must land on the Model").toContain(
        "| TicketCreated (Error e) -> { model with TicketCreateFormServer = e }, Cmd.none",
      );
      expect(app, `the "${field}" field must render its server message`).toContain(
        `(View.serverError model.TicketCreateFormServer "${field}" "tickets-new-server-error-${field}")`,
      );
      expect(app, "what no field takes is the form-level message").toContain(
        '(View.serverFormError model.TicketCreateFormServer [ "title"; "estimate" ] "tickets-new-server-error")',
      );
    },
  },
  {
    id: "flutter",
    platform: "flutter",
    framework: "flutter",
    // Dart — not executable here.  The `ServerErrors` class pinned below was
    // run (`dart run`) against this same golden body and filed the message
    // under "estimate"; this pins every link of the chain that probe rests on.
    statically: (files, field) => {
      const forms = file(files, "web/lib/forms.dart");
      expect(forms, "the submit must decode a rejection, not print its status").toContain(
        "final server = ServerErrors.fromResponse(res.statusCode, res.body);",
      );
      expect(forms).not.toContain("'Request failed (${res.statusCode})'");
      expect(forms, "the decoder must read the errors[] ARRAY").toContain(
        "final entries = decoded['errors'];\n      if (entries is List) {",
      );
      expect(forms).toContain("final message = entry['message'];");
      expect(forms).toContain("final pointer = entry['pointer'];");
      expect(forms, "the form must keep the decoded rejection").toContain("_server = server;");
      expect(forms, "what no field takes is the form-level message").toContain(
        "_error = server.formLevel(_serverFields);",
      );
      expect(forms, `the "${field}" field must render its server message`).toContain(
        `child: Text(_server!.fields['${field}']!,`,
      );
    },
  },
];

/** `<target>` → the defect that keeps it from mapping a real 422 today.
 *  Deleting a line is how the gap closes; a stale line fails the gate.  Empty:
 *  all six map it. */
const WAIVERS: Readonly<Record<string, string>> = {};

// --- harness -----------------------------------------------------------------

function file(files: ReadonlyMap<string, string>, p: string): string {
  const src = files.get(p);
  if (src === undefined) {
    throw new Error(
      `${p} not emitted (have ${[...files.keys()].filter((k) => k.startsWith("web/")).join(", ")})`,
    );
  }
  return src;
}

/** The Angular CreateForm page component — the one declaring a FormGroup. */
function angularFormComponent(files: ReadonlyMap<string, string>): string {
  const hit = [...files].find(
    ([p, s]) => p.startsWith("web/src/app/pages/") && s.includes("new FormGroup("),
  );
  if (!hit) throw new Error("no Angular page component declares a FormGroup");
  return hit[1];
}

/** The control names of the Angular CreateForm's `FormGroup({ name: …, … })`. */
function angularFormControls(files: ReadonlyMap<string, string>): Set<string> {
  const group = /new FormGroup\(\{([^\n]*)\}\);/.exec(angularFormComponent(files));
  if (!group) throw new Error("FormGroup initialiser not found");
  return new Set([...group[1]!.matchAll(/(\w+): new FormControl/g)].map((m) => m[1]!));
}

/** The text of the brace-delimited block that starts at `head` (inclusive). */
function sliceBlock(src: string, head: string): string {
  const start = src.indexOf(head);
  if (start < 0) throw new Error(`block not found: ${head}`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced block: ${head}`);
}

/** Transpile a value-import-free TS module and return one export. */
function evalModule(src: string, name: string): unknown {
  const trimmed = src.replace(/^import type[^;]*;\s*$/gm, "");
  const js = ts.transpileModule(trimmed, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  return new Function("exports", "module", `${js}\nreturn exports.${name};`)(mod.exports, mod);
}

/** The target's OWN `ApiError` class, as its generated client throws it. */
function apiErrorOf(
  files: ReadonlyMap<string, string>,
  clientPath: string,
): new (
  status: number,
  message: string,
  body?: unknown,
) => unknown {
  return evalModule(
    sliceBlock(file(files, clientPath), "export class ApiError"),
    "ApiError",
  ) as never;
}

const system = (t: Target) => `
  system S {${DOMAIN}
    ui Web {
      ${t.framework ? `framework: ${t.framework}` : ""}
      api Work: WorkApi
      page NewTicket { route: "/new" body: CreateForm { of: Ticket } }
    }
    storage db { type: postgres }
    resource st { for: Tracker, kind: state, use: db }
    deployable api { platform: node contexts: [Tracker] dataSources: [st] serves: WorkApi port: 3000 }
    deployable web {
      platform: ${t.platform}
      ${t.design ? `design: ${t.design}` : ""}
      targets: api
      ui: Web { Work: api }
      port: 3005
    }
  }`;

/** The wire pointer → the form's dot-path (`/price/amount` → `price.amount`). */
const fieldOf = (pointer: string): string => pointer.replace(/^\//, "").replaceAll("/", ".");

describe("frontend ACL — a booted backend's 422 lands on the field it names", () => {
  it("the oracle is a real per-field 422 (vacuity guard)", () => {
    expect(REJECTION, "absent-optional golden lost its 422").toBeDefined();
    expect(FIELD_ERROR?.pointer).toMatch(/^\/\w/);
    expect(FIELD_ERROR?.message.length).toBeGreaterThan(0);
  });

  it("every waiver names a real target", () => {
    const ids = new Set(TARGETS.map((t) => t.id));
    for (const k of Object.keys(WAIVERS)) expect(ids.has(k), k).toBe(true);
  });

  for (const t of TARGETS) {
    it(`${t.id}`, async () => {
      const files = await generateSystemFiles(system(t));
      const waiver = WAIVERS[t.id];
      const field = fieldOf(FIELD_ERROR!.pointer);

      if (!t.load && t.statically && !waiver) {
        t.statically(files, field);
        return;
      }
      if (!t.load) {
        // No mapper to execute: only a waiver can pass, and it must still be
        // true — the emitted web tree still reads no `pointer` at all.
        expect(waiver, `${t.id} emits no server-error mapper and carries no waiver`).toBeDefined();
        const web = [...files]
          .filter(([p]) => p.startsWith("web/") && !p.includes("/e2e/") && !p.includes("/test/"))
          .map(([, s]) => s)
          .join("\n");
        expect(web.length).toBeGreaterThan(0);
        expect(
          web,
          `${t.id} now reads ProblemDetails pointers — write its loader, drop the waiver`,
        ).not.toMatch(/\bpointer\b/);
        return;
      }

      const { map, ApiError } = t.load(files);
      const thrown = new ApiError(
        REJECTION!.status,
        String(REJECTION!.body.title ?? "422"),
        REJECTION!.body,
      );
      const mapped = map(thrown);
      if (waiver) {
        expect(
          mapped[field],
          `${t.id} now maps the 422 onto "${field}" — delete its waiver`,
        ).toBeUndefined();
        return;
      }
      expect(mapped, `${t.id}: the 422 did not land on the form field`).toEqual({
        [field]: FIELD_ERROR!.message,
      });
      t.wired?.(files, field);
    });
  }
});

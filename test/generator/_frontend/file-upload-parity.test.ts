// `FileUpload` on the four frontends that had no file-upload test (M-T9.20):
// Vue, Svelte, Angular and Flutter.  React (`react/file-upload.test.ts`) and
// Feliz (`feliz/file-upload.test.ts`) pin the same two surfaces:
//
//   (a) an in-form `File` field (a `CreateForm` over an aggregate with a
//       `File` member) — a file input that POSTs the chosen file as multipart
//       and writes the returned `FileRef` back into THAT form field;
//   (b) a standalone `FileUpload { bind: doc }` — the same upload, written back
//       through the page-state setter.
//
// Rule 12 of the completion plan: the upload PATH is not a constant this test
// or the frontend emitter supplies.  It is read off the node backend's own
// emitted route table in the same generation (`app.post("/files", …)`), and
// every frontend upload site must POST to exactly that path — a frontend that
// uploads to a path the backend does not mount is a guaranteed 404 that no
// per-target string pin can see.
//
// Vacuity guards: each target must yield at least one upload site per surface,
// and the backend must mount exactly one upload route.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

interface Target {
  readonly id: string;
  readonly platform: string;
  readonly design?: string;
  readonly framework?: string;
  /** Emitted file carrying the CreateForm (surface a). */
  readonly createFile: string;
  /** Emitted page carrying the standalone FileUpload (surface b). */
  readonly uploaderFile: string;
  /** The generated API client, when the target has a TS one. */
  readonly clientFile?: string;
  /** Surface (a): the upload result is written into the form's `attachment` field. */
  readonly createWriteBack: RegExp;
  /** Surface (b): the upload result is written through the `doc` state. */
  readonly uploaderWriteBack: RegExp;
}

const TARGETS: readonly Target[] = [
  {
    id: "vue/vuetify",
    platform: "vue",
    design: "vuetify",
    createFile: "web/src/pages/new_attachment.vue",
    uploaderFile: "web/src/pages/uploader.vue",
    clientFile: "web/src/api/client.ts",
    createWriteBack: /form\.values\.attachment = \(await api\.uploadFile\(file\)\)/,
    uploaderWriteBack: /setDoc\(await api\.uploadFile\(file\)\)/,
  },
  {
    id: "vue/shadcnVue",
    platform: "vue",
    design: "shadcnVue",
    createFile: "web/src/pages/new_attachment.vue",
    uploaderFile: "web/src/pages/uploader.vue",
    clientFile: "web/src/api/client.ts",
    createWriteBack: /form\.values\.attachment = \(await api\.uploadFile\(file\)\)/,
    uploaderWriteBack: /setDoc\(await api\.uploadFile\(file\)\)/,
  },
  {
    id: "svelte/shadcnSvelte",
    platform: "svelte",
    design: "shadcnSvelte",
    createFile: "web/src/routes/(app)/new/+page.svelte",
    uploaderFile: "web/src/routes/(app)/upload/+page.svelte",
    clientFile: "web/src/lib/api/client.ts",
    createWriteBack: /form\.values\.attachment = \(await api\.upload\("[^"]+", fd\)\)/,
    uploaderWriteBack: /doc = await api\.upload\("[^"]+", fd\)/,
  },
  {
    id: "svelte/flowbite",
    platform: "svelte",
    design: "flowbite",
    createFile: "web/src/routes/(app)/new/+page.svelte",
    uploaderFile: "web/src/routes/(app)/upload/+page.svelte",
    clientFile: "web/src/lib/api/client.ts",
    createWriteBack: /form\.values\.attachment = \(await api\.upload\("[^"]+", fd\)\)/,
    uploaderWriteBack: /doc = await api\.upload\("[^"]+", fd\)/,
  },
  ...(["angularMaterial", "primeng", "spartanNg"] as const).map(
    (design): Target => ({
      id: `angular/${design}`,
      platform: "angular",
      design,
      createFile: "web/src/app/pages/new-attachment.component.ts",
      uploaderFile: "web/src/app/pages/uploader.component.ts",
      clientFile: "web/src/api/client.ts",
      // The template hands the `attachment` FormControl to the handler, and the
      // handler writes the FileRef into that control.
      createWriteBack:
        /\(change\)="onFileUpload\(\$event, attachmentForm\.get\('attachment'\)\)"[\s\S]*control\.setValue\(await api\.upload\("[^"]+", fd\)\)/,
      uploaderWriteBack:
        /\(change\)="onFileUploadTo\(\$event, doc\)"[\s\S]*sig\.set\(await api\.uploadFile\(file\)\)/,
    }),
  ),
  {
    id: "flutter",
    platform: "flutter",
    framework: "flutter",
    // Flutter pools every CreateForm into `lib/forms.dart`.
    createFile: "web/lib/forms.dart",
    uploaderFile: "web/lib/pages/uploader_page.dart",
    createWriteBack: /setState\(\(\) => _attachment = FileRef\.fromJson\(/,
    uploaderWriteBack: /setDoc\(FileRef\.fromJson\(/,
  },
];

const SRC = (t: Target) => `
system Docs {
  api DocsApi from Media
  subdomain Media {
    context Documents {
      aggregate Attachment with crudish {
        title: string
        attachment: File
      }
      repository Attachments for Attachment { }
    }
  }
  storage db { type: postgres }
  storage blobs { type: localDisk }
  resource docState { for: Documents, kind: state, use: db }
  resource docFiles { for: Documents, kind: objectStore, use: blobs }
  ui WebApp {
    ${t.framework ? `framework: ${t.framework}` : ""}
    api Docs: DocsApi
    page NewAttachment {
      route: "/new"
      body: Stack { Heading { "New", level: 1 }, CreateForm { of: Attachment } }
    }
    page Uploader {
      route: "/upload"
      state { doc: File }
      body: Stack { Heading { "Upload", level: 1 }, FileUpload { "Doc", bind: doc } }
    }
  }
  deployable api { platform: node contexts: [Documents] dataSources: [docState, docFiles] serves: DocsApi port: 3000 }
  deployable web { platform: ${t.platform} targets: api ui: WebApp { Docs: api } port: 3005 ${t.design ? `design: ${t.design}` : ""} }
}
`;

/** Every multipart upload PATH a frontend source posts to, across the three
 *  spellings the targets use: `api.upload("<p>", …)`, the client's
 *  `rawUpload("<p>", …)`, and Dart's `MultipartRequest('POST', apiUri('<p>'))`. */
function uploadPaths(src: string): string[] {
  const out: string[] = [];
  for (const re of [
    /api\.upload\("([^"]+)"/g,
    /rawUpload\("([^"]+)"/g,
    /MultipartRequest\('POST', apiUri\('([^']+)'\)\)/g,
  ]) {
    for (const m of src.matchAll(re)) out.push(m[1]!);
  }
  return out;
}

/** The multipart upload route(s) the node backend mounts, and the form-field
 *  name each reads the file from — read off its own route table: a POST whose
 *  handler opens with `parseBody()`, whatever the path is called. */
function backendUploadRoutes(
  files: ReadonlyMap<string, string>,
): { path: string; field: string }[] {
  const routes: { path: string; field: string }[] = [];
  for (const [p, src] of files) {
    if (!p.startsWith("api/") || !p.endsWith(".ts")) continue;
    for (const m of src.matchAll(
      /app\.post\("([^"]+)", async \(c\) => \{\s*const body = await c\.req\.parseBody\(\);\s*const file = body\["([^"]+)"\]/g,
    )) {
      routes.push({ path: m[1]!, field: m[2]! });
    }
  }
  return routes;
}

function fileOf(files: ReadonlyMap<string, string>, path: string, id: string): string {
  const src = files.get(path);
  expect(
    src,
    `${id}: ${path} not emitted (have: ${[...files.keys()].filter((k) => k.startsWith("web/")).join(", ")})`,
  ).toBeDefined();
  return src!;
}

describe("FileUpload on Vue / Svelte / Angular / Flutter (M-T9.20)", () => {
  for (const t of TARGETS) {
    describe(t.id, () => {
      it("both surfaces upload to the route the BACKEND mounts, and write the FileRef back", async () => {
        const files = await generateSystemFiles(SRC(t));
        const routes = backendUploadRoutes(files);
        // Vacuity guard: the backend mounts exactly one multipart upload route.
        expect(routes, "node backend upload routes").toHaveLength(1);
        const [{ path: route, field }] = routes;

        const create = fileOf(files, t.createFile, t.id);
        const uploader = fileOf(files, t.uploaderFile, t.id);
        // The client helper is where Vue's `uploadFile` and Angular's standalone
        // path post from; the page source only carries `api.uploadFile(file)`.
        const client = t.clientFile ? fileOf(files, t.clientFile, t.id) : "";

        for (const [surface, src, writeBack] of [
          ["create form (a)", create, t.createWriteBack],
          ["standalone FileUpload (b)", uploader, t.uploaderWriteBack],
        ] as const) {
          const usesClientHelper = /api\.uploadFile\(file\)/.test(src);
          const paths = uploadPaths(usesClientHelper ? `${src}\n${client}` : src);
          expect(paths.length, `${t.id} ${surface}: no upload site found`).toBeGreaterThan(0);
          for (const p of paths) {
            expect(p, `${t.id} ${surface}: uploads somewhere the backend does not mount`).toBe(
              route,
            );
          }
          expect(src, `${t.id} ${surface}: the FileRef is not written back`).toMatch(writeBack);
          // …and the multipart part carries the field name the backend reads.
          const partSrc = usesClientHelper ? client : src;
          expect(
            partSrc.includes(`fd.append("${field}", `) ||
              partSrc.includes(`form.append("${field}", `) ||
              partSrc.includes(`MultipartFile.fromBytes('${field}', `),
            `${t.id} ${surface}: the file part is not named "${field}" (the backend's field)`,
          ).toBe(true);
        }
      });

      if (t.clientFile) {
        it("the multipart client helper leaves content-type to the browser", async () => {
          const client = fileOf(await generateSystemFiles(SRC(t)), t.clientFile!, t.id);
          const body = client.slice(client.indexOf("async function rawUpload("));
          const fn = body.slice(0, body.indexOf("\n}\n"));
          expect(fn, `${t.id}: no rawUpload helper`).toContain("body: form,");
          // A hardcoded content-type drops the multipart boundary → the server
          // cannot split the body.  (The JSON `rawFetch` sets one; this must not.)
          expect(fn.toLowerCase()).not.toContain("content-type");
          expect(client).toMatch(/form\.append\("file", file\)/);
        });
      }
    });
  }
});

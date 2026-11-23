// Frontend ACL emission — verifies that the React generator writes the
// two shared utility files (`src/lib/strict-field-map.ts` and
// `src/lib/apply-server-errors.ts`) into every generated React project,
// regardless of pack or example.  See https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/proposals/frontend-acl.md
// and https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/plans/frontend-acl-implementation.md (Phase 1, Steps 1.1–1.2).
//
// These files are pack-agnostic — Mantine and shadcn projects must emit
// byte-identical copies — and behaviourally inert in Phase 1 (no
// generated code calls into them yet; Phase 2 wires the form walker's
// catch block through `applyServerErrors`).

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateSystemFilesFromProject } from "../../_helpers/generate.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");

const buildAcme = (): Promise<Map<string, string>> =>
  generateSystemFilesFromProject(path.join(repoRoot, "examples/acme.ddd"));

describe("frontend ACL shared files — emission", () => {
  it("emits src/lib/strict-field-map.ts into every React deployable", async () => {
    const files = await buildAcme();
    const keys = [...files.keys()];
    const reactRoots = keys
      .filter((k) => k.endsWith("/src/main.tsx"))
      .map((k) => k.slice(0, -"/src/main.tsx".length));
    expect(reactRoots.length).toBeGreaterThan(0);
    for (const root of reactRoots) {
      expect(keys).toContain(`${root}/src/lib/strict-field-map.ts`);
    }
  });

  it("emits src/lib/apply-server-errors.ts into every React deployable", async () => {
    const files = await buildAcme();
    const keys = [...files.keys()];
    const reactRoots = keys
      .filter((k) => k.endsWith("/src/main.tsx"))
      .map((k) => k.slice(0, -"/src/main.tsx".length));
    expect(reactRoots.length).toBeGreaterThan(0);
    for (const root of reactRoots) {
      expect(keys).toContain(`${root}/src/lib/apply-server-errors.ts`);
    }
  });
});

describe("frontend ACL shared files — content", () => {
  it("strict-field-map.ts is type-only (no runtime statements after imports)", async () => {
    const files = await buildAcme();
    const mainKey = [...files.keys()].find((k) => k.endsWith("/src/main.tsx"))!;
    const reactRoot = mainKey.slice(0, -"/src/main.tsx".length);
    const src = files.get(`${reactRoot}/src/lib/strict-field-map.ts`)!;
    expect(src).toMatch(/type NestedPaths<T>/);
    expect(src).toMatch(/export type StrictFieldMap<TPayload, TFormState>/);
    // No runtime: no `export function`, no `export const` (the file emits
    // only type aliases — must be fully erased from the bundle).
    expect(src).not.toMatch(/export function/);
    expect(src).not.toMatch(/export const/);
  });

  it("apply-server-errors.ts exports applyServerErrors with the locked signature", async () => {
    const files = await buildAcme();
    const mainKey = [...files.keys()].find((k) => k.endsWith("/src/main.tsx"))!;
    const reactRoot = mainKey.slice(0, -"/src/main.tsx".length);
    const src = files.get(`${reactRoot}/src/lib/apply-server-errors.ts`)!;
    // The two outcomes: field errors placed, or ONE message on the form.
    expect(src).toMatch(/kind:\s*"fields"/);
    expect(src).toMatch(/kind:\s*"form"/);
    expect(src).not.toMatch(/kind:\s*"unhandled"/);
    // The function itself.
    expect(src).toMatch(/export function applyServerErrors</);
    // Imports the type from the sibling file (relative import, no
    // pack-specific path).
    expect(src).toMatch(/from "\.\/strict-field-map"/);
    // Pulls RHF types only (no value imports — RHF would be a runtime
    // bundle cost we don't need; `Path` etc. are types).
    expect(src).toMatch(
      /import type \{ UseFormSetError, FieldValues, Path \} from "react-hook-form"/,
    );
    // Reads the ApiError shape the generated client actually throws
    // (`{ status, body }`), not an axios-style `.response` envelope (the bug
    // that left this path dormant).  Only a 422 with `errors[]` is field-level.
    expect(src).toMatch(/e\.status === 422 && Array\.isArray\(pd\.errors\)/);
    expect(src).not.toContain(".response");
    // The JSON pointer → flat key translator is the linchpin of the ACL.
    expect(src).toMatch(/pointerToFlat/);
  });

  it("apply-server-errors.ts has no toast / notifications / pack-specific calls", async () => {
    // Architectural invariant: the runtime helper is pack-agnostic.  The
    // failure shows on the form (`FormFailure`), never through a pack toast.
    const files = await buildAcme();
    const mainKey = [...files.keys()].find((k) => k.endsWith("/src/main.tsx"))!;
    const reactRoot = mainKey.slice(0, -"/src/main.tsx".length);
    const src = files.get(`${reactRoot}/src/lib/apply-server-errors.ts`)!;
    expect(src).not.toMatch(/notifications\./);
    expect(src).not.toMatch(/\btoast\b/);
    expect(src).not.toMatch(/enqueueSnackbar/);
    expect(src).not.toMatch(/useToast/);
  });
});

describe("frontend ACL — wired into emitted form catch blocks (Phase 2)", () => {
  // Verifies the ACL loop is live in the generated React project — every
  // generated form's submit handler calls applyServerErrors with setError
  // and switches on the outcome.  Independent of fixture snapshots so
  // tightening / refactoring the catch shape can't silently disable the
  // loop.

  it("orders/new.tsx (form-of/create) imports and uses applyServerErrors", async () => {
    const files = await buildAcme();
    const mainKey = [...files.keys()].find((k) => k.endsWith("/src/main.tsx"))!;
    const reactRoot = mainKey.slice(0, -"/src/main.tsx".length);
    const src = files.get(`${reactRoot}/src/pages/orders/new.tsx`)!;
    expect(src).toMatch(
      /import \{ applyServerErrors \} from "\.\.\/\.\.\/lib\/apply-server-errors"/,
    );
    expect(src).toMatch(/setError/);
    expect(src).toMatch(
      /applyServerErrors\(\{\s*error:\s*e,\s*setError,\s*fieldMap:\s*\{\}\s*as const\s*\}\)/,
    );
    // The failure message is one element inside the form; the catch block
    // switches on nothing and notifies nothing.
    expect(src).not.toMatch(/outcome\.kind/);
    expect(src).toMatch(
      /<FormFailure error=\{errors\.root\?\.submit\} testid="orders-new-error" \/>/,
    );
    expect(src).toMatch(/import \{ FormFailure \} from "\.\.\/\.\.\/lib\/form-failure"/);
  });

  it("orders/detail.tsx (form-op/modal) imports and uses applyServerErrors", async () => {
    const files = await buildAcme();
    const mainKey = [...files.keys()].find((k) => k.endsWith("/src/main.tsx"))!;
    const reactRoot = mainKey.slice(0, -"/src/main.tsx".length);
    const src = files.get(`${reactRoot}/src/pages/orders/detail.tsx`)!;
    expect(src).toMatch(
      /import \{ applyServerErrors \} from "\.\.\/\.\.\/lib\/apply-server-errors"/,
    );
    // Three op-forms on this page (AddLine + Confirm + crudish `update`) —
    // all should be wired.
    const calls = src.match(/applyServerErrors\(\{/g) ?? [];
    expect(calls.length).toBe(3);
    // setError is destructured from useForm in every op-form component.
    // The destructure can carry a nested `formState: { errors }` (the
    // crudish `update` form does), so match the field list with `[^=]`
    // rather than `[^}]` — `[^}]` stops at the first inner `}` and
    // under-counts forms with nested destructuring.
    const setErrorDestructures = src.match(/\{[^=]*\bsetError\b[^=]*\}\s*=\s*useForm</g) ?? [];
    expect(setErrorDestructures.length).toBe(3);
  });

  it("workflows/place_order.tsx (form-runs) imports and uses applyServerErrors", async () => {
    const files = await buildAcme();
    const mainKey = [...files.keys()].find((k) => k.endsWith("/src/main.tsx"))!;
    const reactRoot = mainKey.slice(0, -"/src/main.tsx".length);
    const src = files.get(`${reactRoot}/src/pages/workflows/place_order.tsx`)!;
    expect(src).toMatch(
      /import \{ applyServerErrors \} from "\.\.\/\.\.\/lib\/apply-server-errors"/,
    );
    expect(src).toMatch(/setError/);
    expect(src).toMatch(/applyServerErrors\(\{/);
  });

  it("a failed submit never reaches a pack toast; the success toast is untouched", async () => {
    // Mantine pack — the catch block calls applyServerErrors and nothing else.
    // Successful-path notification is untouched.
    const files = await buildAcme();
    const mainKey = [...files.keys()].find((k) => k.endsWith("/src/main.tsx"))!;
    const reactRoot = mainKey.slice(0, -"/src/main.tsx".length);
    const src = files.get(`${reactRoot}/src/pages/orders/new.tsx`)!;
    expect(src).not.toMatch(/notifications\.show\(\{ color: "red"/);
    expect(src).toMatch(
      /notifications\.show\(\{ color: "green", message: t\("chrome\.created\.Order", "Order created"\) \}\)/,
    );
  });
});

// ---------------------------------------------------------------------------
// Behavioural test for the emitted applyServerErrors runtime.
//
// Static text assertions above prove the function is emitted with the right
// SHAPE. This block transpiles the emitted source and EXECUTES it against
// synthetic ProblemDetails / network-error inputs, proving the loop's
// actual semantics — pointer→flat key translation, setError dispatch,
// outcome branching, fallback behaviour for non-422 errors.
// ---------------------------------------------------------------------------

import ts from "typescript";

interface SetErrorCall {
  field: string;
  options: { type: string; message: string };
}

/** Transpile the emitted apply-server-errors.ts to JS (strip types,
 *  drop type-only imports) and return the live applyServerErrors
 *  function.  Tied to the generated source — any drift in the
 *  emitted text that breaks transpilation or invocation surfaces
 *  here as a test failure. */
function loadApplyServerErrors(
  src: string,
): (args: {
  error: unknown;
  setError: (field: string, options: { type: string; message: string }) => void;
  fieldMap: Record<string, string>;
}) => { kind: "fields" } | { kind: "form" } {
  // Strip the `import type { … } from "react-hook-form";` line — it's
  // type-only and would fail to resolve in a vm context.  TypeScript's
  // transpiler also elides import-types, so removing manually is a
  // belt-and-braces guard.
  const trimmed = src.replace(/import type[\s\S]*?from\s*"react-hook-form";\s*\n/g, "");
  const js = ts.transpileModule(trimmed, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText;

  // Eval the CJS-shaped output in a function that closes over `exports`
  // and `module`, returning the named binding.  The one value import is the
  // app's `t` (an i18n-enabled app localizes by code); bound here to a catalog
  // with no entries, so every message falls back to the server's English.
  const factory = new Function(
    "exports",
    "module",
    "require",
    `${js}\nreturn exports.applyServerErrors;`,
  );
  const mod = { exports: {} as Record<string, unknown> };
  const require = (id: string) => {
    if (id === "../i18n") return { t: (_key: string, fallback: string) => fallback };
    throw new Error(`unexpected import ${id}`);
  };
  return factory(mod.exports, mod, require) as never;
}

function readApplyServerErrorsSrc(files: Map<string, string>): string {
  const mainKey = [...files.keys()].find((k) => k.endsWith("/src/main.tsx"))!;
  const reactRoot = mainKey.slice(0, -"/src/main.tsx".length);
  return files.get(`${reactRoot}/src/lib/apply-server-errors.ts`)!;
}

describe("applyServerErrors — runtime behaviour against synthetic inputs", () => {
  it("returns { kind: 'fields' } and dispatches setError per pointer for a 422 with errors[]", async () => {
    const files = await buildAcme();
    const fn = loadApplyServerErrors(readApplyServerErrorsSrc(files));

    const calls: SetErrorCall[] = [];
    const setError = (field: string, options: { type: string; message: string }): void => {
      calls.push({ field, options });
    };

    const outcome = fn({
      error: {
        status: 422,
        body: {
          errors: [
            { pointer: "/price/amount", message: "must be positive" },
            { pointer: "/name", message: "too short" },
          ],
        },
      },
      setError,
      fieldMap: {},
    });

    expect(outcome).toEqual({ kind: "fields" });
    expect(calls).toEqual([
      { field: "price.amount", options: { type: "server", message: "must be positive" } },
      { field: "name", options: { type: "server", message: "too short" } },
    ]);
  });

  it("routes pointers through the fieldMap when explicit mapping exists", async () => {
    // When the wire pointer ('/price.amount' rooted differently) doesn't
    // match the form-state key directly, the FieldMap is the lookup
    // table.  This proves the indirection is wired correctly even
    // though Phase 2's MVP uses an identity (empty) map.
    const files = await buildAcme();
    const fn = loadApplyServerErrors(readApplyServerErrorsSrc(files));

    const calls: SetErrorCall[] = [];
    const setError = (field: string, options: { type: string; message: string }): void => {
      calls.push({ field, options });
    };

    fn({
      error: {
        status: 422,
        body: { errors: [{ pointer: "/price/amount", message: "bad" }] },
      },
      setError,
      fieldMap: { "price.amount": "priceAmountFlat" },
    });

    expect(calls).toEqual([
      { field: "priceAmountFlat", options: { type: "server", message: "bad" } },
    ]);
  });

  it("puts a 422 with a title but no errors[] on the form (root.submit)", async () => {
    const files = await buildAcme();
    const fn = loadApplyServerErrors(readApplyServerErrorsSrc(files));
    const calls: SetErrorCall[] = [];

    const outcome = fn({
      error: {
        status: 422,
        body: { title: "Inventory conflict — please retry" },
      },
      setError: (field, options) => calls.push({ field, options }),
      fieldMap: {},
    });

    expect(outcome).toEqual({ kind: "form" });
    expect(calls).toEqual([
      {
        field: "root.submit",
        options: { type: "server", message: "Inventory conflict — please retry" },
      },
    ]);
  });

  it("puts a 500 on the form, by the English of its status's code", async () => {
    const files = await buildAcme();
    const fn = loadApplyServerErrors(readApplyServerErrorsSrc(files));
    const calls: SetErrorCall[] = [];

    const outcome = fn({
      error: { status: 500, body: { title: "Internal Server Error" } },
      setError: (field, options) => calls.push({ field, options }),
      fieldMap: {},
    });

    expect(outcome).toEqual({ kind: "form" });
    expect(calls).toEqual([
      {
        field: "root.submit",
        options: { type: "server", message: "Internal Server Error" },
      },
    ]);
  });

  it("puts a network failure (no response object) on the form as the unreachable sentence", async () => {
    const files = await buildAcme();
    const fn = loadApplyServerErrors(readApplyServerErrorsSrc(files));
    const calls: SetErrorCall[] = [];

    const outcome = fn({
      error: new Error("Network timeout"),
      setError: (field, options) => calls.push({ field, options }),
      fieldMap: {},
    });

    expect(outcome).toEqual({ kind: "form" });
    expect(calls).toEqual([
      {
        field: "root.submit",
        options: { type: "server", message: "Could not reach the server. Try again." },
      },
    ]);
  });

  it("decodes URI-encoded JSON pointer segments correctly", async () => {
    // RFC 6901 percent-escaping inside pointer segments — `/foo%2Fbar`
    // should decode to the flat key `foo/bar`.  Edge case but cheap to
    // assert; protects against pointer-to-flat regressions.
    const files = await buildAcme();
    const fn = loadApplyServerErrors(readApplyServerErrorsSrc(files));
    const calls: SetErrorCall[] = [];

    fn({
      error: {
        status: 422,
        body: { errors: [{ pointer: "/foo%2Fbar", message: "x" }] },
      },
      setError: (field, options) => calls.push({ field, options }),
      fieldMap: {},
    });

    expect(calls[0].field).toBe("foo/bar");
  });

  it("falls back to flat pointer when no fieldMap match (identity behaviour)", async () => {
    // The Phase 2 MVP relies on this: empty fieldMap means every
    // pointer routes to itself (after the flatten transform).  Without
    // this fallback, every form would need a populated fieldMap to do
    // anything at all.
    const files = await buildAcme();
    const fn = loadApplyServerErrors(readApplyServerErrorsSrc(files));
    const calls: SetErrorCall[] = [];

    fn({
      error: {
        status: 422,
        body: { errors: [{ pointer: "/customerId", message: "x" }] },
      },
      setError: (field, options) => calls.push({ field, options }),
      fieldMap: {},
    });

    expect(calls[0].field).toBe("customerId");
  });
});

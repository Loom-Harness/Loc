// Static (non-templated) sources the Svelte generator emits verbatim.
// Sibling of src/generator/react/emit-templates.ts.

import {
  ERROR_CODE_HELPERS_TS,
  errorCodeTBinding,
  submitFailureTs,
} from "../_frontend/error-codes.js";
import { MONEY_SCHEMA_TS } from "../_frontend/money-schema.js";
import { TS_RUNTIME } from "../_symbols/plan.js";

/** `src/lib/forms.svelte.ts` — the hand-rolled runes + zod form
 *  helper (svelte-frontend-plan.md decision: no third-party form
 *  dependency).  Mirrors the surface the react packs get from
 *  react-hook-form + apply-server-errors: `form.values` (bind:
 *  targets, deep-reactive), `form.errors` (per-field message map
 *  keyed by dotted path), `form.submit(onValid)` (zod parse → error
 *  map fill → submit), `form.applyServerErrors(e)` (a failed submit: an RFC
 *  7807 422's field errors on their fields, any other failure as the form's
 *  one message, `form.failure`). */
const SVELTE_LIB_FORMS_TEMPLATE = `// Auto-generated.  Do not edit by hand.
import type { z } from "zod";
/*{{T_BINDING}}*/
/*{{HELPERS}}*/
/** A form error with the catalog identity it localizes by.  The map a page
 *  reads (\`errors\`) is built from these when it is READ, so the text is
 *  localized at render time, not when the schema or the server answered. */
interface FormError {
  code: string;
  message: string;
  params?: Record<string, unknown>;
}

/** The wire shape of an uploaded file — the \`File\` request field's schema
 *  (\`_frontend/zod-schemas.ts\`) is this object, \`.nullable()\`. */
type FileRefValue = { url: string; key: string; contentType: string; size: number };

/** The value shape a form BINDS.
 *
 *  A request field's optionality is a WIRE fact — "the client may omit it" —
 *  and types as \`T | null | undefined\`.  It is not a fact about the bound
 *  value: \`createForm\` SEEDS every field the form renders, and a scalar's seed
 *  is its type's zero (\`""\` / \`0\` / \`false\`), a value object's seed a whole
 *  object.  Typing \`values\` straight off the schema therefore handed every
 *  \`bind:value\` a \`T | null | undefined\` that a typed pack input rejects
 *  (flowbite's \`InputValue\`), and made an optional value object unreadable
 *  without the null check the seed has already ruled out
 *  (\`'form.values.budget' is possibly 'null' or 'undefined'\`).
 *
 *  So: strip \`null | undefined\` off every bound field, at EVERY depth.  It was
 *  one level once, on the premise that "a value object's own sub-fields are
 *  already required" — which an optional sub-field
 *  (\`valueobject Address { line1: string  line2: string?  city: string }\`)
 *  falsifies: \`form.values.shipping.line2\` came back \`string | null | undefined\`
 *  and the input rejected it, one level below where the strip stopped.  The
 *  seed is the reason this is sound at any depth — the form seeds every field it
 *  RENDERS, nested optional sub-fields included (\`{ shipping: { line1: "",
 *  line2: "", city: "" } }\`).
 *
 *  The recursion stops at CLASS INSTANCES, and \`Record<string, unknown>\` is what
 *  stops it: a zod object infers to an anonymous object type, which TypeScript
 *  gives an implicit index signature, while a CLASS or INTERFACE declaration
 *  (a \`money\` \`Decimal\`, a \`Date\`) does not — so a class instance falls
 *  through to the leaf arm untouched.  It has to: mapping over \`Decimal\`'s
 *  members would strip its call signatures and break \`new Decimal(...)\`
 *  assignment.  Naming the decimal package here instead would be
 *  simpler and wrong: it is a CONDITIONAL dependency of the generated project
 *  (each pack's package.json adds it only when the model \`usesMoney\`), and this
 *  runtime file is emitted by money-free projects too — which is why not even
 *  this comment spells the specifier.  A \`File\` request field is the one field
 *  kept nullable: "nothing uploaded yet" is a real state the form seeds as
 *  \`null\` and the upload handler assigns back.
 *
 *  A number or a \`Decimal\` leaf (anything with \`toFixed\`) binds as text too:
 *  its input holds what the user typed, and the schema parses it by the form
 *  text rule (\`lib/form-text\`).
 *
 *  The SCHEMA type is untouched — \`submit\`'s \`onValid\` still receives exactly
 *  what the wire declares. */
export type FormValues<T> = T extends FileRefValue
  ? T | null
  : T extends readonly (infer E)[]
    ? FormValues<NonNullable<E>>[]
    : T extends Record<string, unknown>
      ? { [K in keyof T]-?: BoundField<T[K]> }
      : T extends { toFixed: unknown }
        ? T | string
        : T;

/** One bound field: \`null | undefined\` stripped, except that an OPTIONAL value
 *  object keeps \`null\` — its form group is opt-in, and \`null\` is how the form
 *  holds "not added" (the group's inputs mount only while it is present). */
type BoundField<V> = null extends V
  ? NonNullable<V> extends Record<string, unknown>
    ? NonNullable<V> extends FileRefValue
      ? FormValues<NonNullable<V>>
      : FormValues<NonNullable<V>> | null
    : FormValues<NonNullable<V>>
  : FormValues<NonNullable<V>>;

export interface LoomForm<T> {
  values: FormValues<T>;
  readonly errors: Record<string, string>;
  readonly submitting: boolean;
  reset(): void;
  submit(onValid: (vals: T) => Promise<void> | void): Promise<void>;
  /** The one message a failed submit shows on the form: a refusal's catalog
   *  text, or the unreachable sentence.  Null until a submit fails; cleared
   *  when the next submit starts. */
  readonly failure: string | null;
  /** Show what a failed submit answered: a 422's \`errors\` ARRAY (\`{ pointer,
   *  code, message }\`) on their fields (a pointer-less entry is the form's
   *  message), any other failure as \`failure\`. */
  applyServerErrors(e: unknown): { kind: "fields" } | { kind: "form" };
}

/** Deep-copy the defaults while PRESERVING prototypes.
 *
 *  \`structuredClone\` cannot be used here: it drops the prototype off class
 *  instances, so a \`money\` seed (a \`Decimal\`) came back as a prototype-less
 *  bag — the input rendered \`[object Object]\` and an untouched default could
 *  never satisfy the money schema.  Only ARRAYS and PLAIN objects are copied
 *  (a fresh form must not share mutable structure with the seed); everything
 *  else — class instances, dates, primitives, null — is carried by reference,
 *  which is safe because those values are only ever REPLACED by the inputs,
 *  never mutated in place.
 */
function cloneDefaults<T>(v: T): T {
  if (Array.isArray(v)) return v.map(cloneDefaults) as unknown as T;
  if (typeof v === "object" && v !== null && Object.getPrototypeOf(v) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = cloneDefaults(val);
    }
    return out as T;
  }
  return v;
}

/** \`defaults\` is \`Partial\` because a form seeds exactly the fields it
 *  RENDERS, and a create form renders only the aggregate's create input — the
 *  optional fields it leaves out are neither seeded nor bound.  Every field the
 *  form does render is seeded, which is what makes \`FormValues\` sound for
 *  \`values\`. */
export function createForm<S extends z.ZodType>(
  schema: S,
  defaults: Partial<FormValues<z.infer<S>>>,
): LoomForm<z.infer<S>> {
  let values = $state(cloneDefaults(defaults) as FormValues<z.infer<S>>);
  let errorEntries = $state<Record<string, FormError>>({});
  let submitting = $state(false);
  let failure = $state<string | null>(null);

  return {
    get values() {
      return values;
    },
    set values(v: FormValues<z.infer<S>>) {
      values = v;
    },
    get errors() {
      const out: Record<string, string> = {};
      for (const [path, e] of Object.entries(errorEntries)) out[path] = localizeProblem(e.code, e.message, e.params);
      return out;
    },
    get submitting() {
      return submitting;
    },
    get failure() {
      return failure;
    },
    reset() {
      values = cloneDefaults(defaults) as FormValues<z.infer<S>>;
      errorEntries = {};
      failure = null;
    },
    async submit(onValid: (vals: z.infer<S>) => Promise<void> | void) {
      failure = null;
      const parsed = schema.safeParse(values);
      if (!parsed.success) {
        const next: Record<string, FormError> = {};
        for (const issue of parsed.error.issues as { path: PropertyKey[]; message: string; code?: string; params?: Record<string, unknown> }[]) {
          const path = issue.path.join(".");
          next[path] ??= {
            code: issueCatalogCode(issue as { code?: string; params?: { ${TS_RUNTIME.issueCode}?: string } }),
            message: issue.message,
            params: issueCatalogParams(issue),
          };
        }
        errorEntries = next;
        return;
      }
      errorEntries = {};
      submitting = true;
      try {
        await onValid(parsed.data);
      } finally {
        submitting = false;
      }
    },
    applyServerErrors(e: unknown) {
      const outcome = classifySubmitFailure(e);
      if (outcome.kind === "form") {
        failure = outcome.message;
        return { kind: "form" as const };
      }
      const body = (e as { body?: { errors?: unknown[] } }).body;
      const next: Record<string, FormError> = { ...errorEntries };
      for (const entry of body?.errors ?? []) {
        if (!entry || typeof entry !== "object") continue;
        const { pointer, message, code, params } = entry as {
          pointer?: unknown;
          message?: unknown;
          code?: unknown;
          params?: Record<string, unknown>;
        };
        if (typeof message !== "string" || message.length === 0) continue;
        // An entry whose JSON pointer names a field lands on that field's
        // dot-path (\`/price/amount\` → \`price.amount\`); a pointer-less entry (a
        // whole-object rule) is the form's message.
        const path = typeof pointer === "string" ? pointerToPath(pointer) : "";
        if (path) {
          next[path] = { code: typeof code === "string" ? code : "field.rule", message, params };
        } else {
          failure ??= localizeProblem(typeof code === "string" ? code : "problem.internal", message, params);
        }
      }
      errorEntries = next;
      return { kind: "fields" as const };
    },
  };
}

/** A JSON pointer (RFC 6901) as the form's dot-path; "" for the whole document. */
function pointerToPath(pointer: string): string {
  if (!pointer.startsWith("/")) return pointer;
  return pointer
    .slice(1)
    .split("/")
    .map((seg) => decodeURIComponent(seg).replaceAll("~1", "/").replaceAll("~0", "~"))
    .join(".");
}

/** Modal focus trap (a Svelte \`use:\` action).  On mount it moves focus to the
 *  first focusable element inside the node; Tab / Shift+Tab cycle within it;
 *  Escape invokes \`onClose\`; and on teardown focus returns to whatever had it
 *  before the modal opened.  The library dialog components (Radix, vuetify,
 *  Angular Material, HEEx \`.modal\`) provide this natively — the raw-\`<div>\`
 *  op-modals in the shadcnSvelte / flowbite packs need it emitted. */
export function modalTrap(node: HTMLElement, onClose: () => void) {
  const previouslyFocused = document.activeElement as HTMLElement | null;
  const selector =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const focusables = (): HTMLElement[] =>
    Array.from(node.querySelectorAll<HTMLElement>(selector)).filter((el) => el.offsetParent !== null);
  (focusables()[0] ?? node).focus();
  function onKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const items = focusables();
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  node.addEventListener("keydown", onKeydown);
  return {
    destroy(): void {
      node.removeEventListener("keydown", onKeydown);
      previouslyFocused?.focus?.();
    },
  };
}
`;

export function svelteLibForms(i18n: boolean): string {
  return SVELTE_LIB_FORMS_TEMPLATE.replace("/*{{T_BINDING}}*/", () =>
    errorCodeTBinding(i18n, "./locale.svelte"),
  ).replace("/*{{HELPERS}}*/", () => `${ERROR_CODE_HELPERS_TS}\n${submitFailureTs(i18n)}`);
}

/** The forms runtime of an app without a catalog. */
export const SVELTE_LIB_FORMS = svelteLibForms(false);

/** `src/lib/toast.svelte.ts` — minimal runes toast store + helpers.
 *  The root layout renders the matching container.  Keeps the
 *  default-submit "saved / failed" feedback parity with the react
 *  packs without a notification dependency. */
export const SVELTE_LIB_TOAST = `// Auto-generated.  Do not edit by hand.

export interface Toast {
  id: number;
  kind: "success" | "error";
  message: string;
}

let nextId = 1;
const items = $state<Toast[]>([]);

function push(kind: Toast["kind"], message: string): void {
  const id = nextId++;
  items.push({ id, kind, message });
  setTimeout(() => {
    const i = items.findIndex((t) => t.id === id);
    if (i !== -1) items.splice(i, 1);
  }, 4000);
}

export const toast = {
  get items() {
    return items;
  },
  success(message: string) {
    push("success", message);
  },
  error(message: string) {
    push("error", message);
  },
};
`;

/** `src/lib/schemas.ts` — shared money wire schema, the same source the
 *  React and Vue projects emit (`_frontend/money-schema.ts`). */
export const SVELTE_LIB_SCHEMAS_MONEY = MONEY_SCHEMA_TS;

/** `src/app.d.ts` — SvelteKit ambient types.  `PageState` carries the
 *  shallow-routing state `navigate(path, { state })` writes. */
export const SVELTE_APP_DTS = `// Auto-generated.  Do not edit by hand.
declare global {
  namespace App {
    interface PageState {
      [key: string]: unknown;
    }
  }
}

export {};
`;

/** `src/routes/+layout.ts` — SPA mode: no SSR, no prerender; the
 *  adapter-static fallback (index.html) serves every deep link. */
export const SVELTE_LAYOUT_TS = `// Auto-generated.  Do not edit by hand.
export const ssr = false;
export const prerender = false;
`;

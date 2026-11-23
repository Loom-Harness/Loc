// ---------------------------------------------------------------------------
// Static emitted-source constants for generated React projects — the
// pack-agnostic files written verbatim into every project (src/lib
// frontend-ACL helpers + money schema, and the Playwright e2e harness).
// Extracted from index.ts so the orchestrator stays focused on assembly.
// ---------------------------------------------------------------------------

import { PROBLEM_KEY_TS, submitFailureTs } from "../_frontend/error-codes.js";
import { MONEY_SCHEMA_TS } from "../_frontend/money-schema.js";
import { TS_RUNTIME } from "../_symbols/plan.js";

// Shared `moneySchema` helper for React projects — emitted to
// `src/lib/schemas.ts` whenever the served deployable touches money.  The one
// definition (and why a parsed value keeps the wire's scale) lives in
// `_frontend/money-schema.ts`, shared with Vue and Svelte.
export const REACT_LIB_SCHEMAS_MONEY_TS = MONEY_SCHEMA_TS;

// =============================================================================
// Frontend ACL shared utilities.
//
// Both files are pack-agnostic and emitted into every React project under
// src/lib/.  Per-action FieldMap *instances* are NOT emitted here — they
// live next to their action's schema (currently inside src/api/<agg>.ts,
// or src/lib/schemas/<action>.schema.ts after a future schema split).
// =============================================================================

/**
 * Compile-time type machinery — erased from the runtime bundle.  Pinned
 * to every per-action FieldMap via a `satisfies StrictFieldMap<...>`
 * clause so wire-shape drift surfaces as a TSC error at the schema
 * file, not as a silent error-misrouting at runtime.
 */
export const REACT_LIB_STRICT_FIELD_MAP_TS = `// Auto-generated.  Do not edit by hand.

type NestedPaths<T> = T extends object
  ? {
      [K in keyof T & string]: T[K] extends object
        ? \`\${K}.\${NestedPaths<T[K]>}\`
        : \`\${K}\`;
    }[keyof T & string]
  : never;

/**
 * Strict bidirectional pin between a payload's nested shape and a form
 * state's flat key set.  Keys MUST be valid dot-notation leaf paths of
 * the payload; values MUST be valid keys of the form state.  Used as a
 * \`satisfies\` constraint on per-action FieldMap constants.
 */
export type StrictFieldMap<TPayload, TFormState> = {
  readonly [K in NestedPaths<TPayload>]?: keyof TFormState & string;
};
`;

/**
 * Runtime decoder for a failed submit.  Called from the form walker's generated
 * catch block: a 422's `errors[]` land on their fields, and every other
 * failure (a refusal, no answer at all) becomes ONE message on the form, held
 * as react-hook-form's `root.submit` error and rendered by `FormFailure`.
 * Pure logic, no pack specifics.
 *
 * The server never translates a response: every refusal carries the catalog
 * `code` it is localized by (and the `params` its message names), so this is
 * the app's one server-error localizer — `t(pd.code, pd.detail, pd.params)`
 * for the refusal, `t(e.code, e.message, e.params)` per field.  Under i18n
 * `t` is the app's catalog lookup; without it the English `detail` /
 * `message` the server sent is shown as-is.
 */
export function reactLibApplyServerErrorsTs(i18n: boolean): string {
  const tImport = i18n ? 'import { t } from "../i18n";\n' : "";
  const tLocal = i18n
    ? ""
    : `
/** No catalog in this app: the server's English is the text. */
const t = (_code: string, fallback: string, _params?: Record<string, unknown>): string => fallback;
`;
  return `// Auto-generated.  Do not edit by hand.

import type { UseFormSetError, FieldValues, Path } from "react-hook-form";
${tImport}import type { StrictFieldMap } from "./strict-field-map";
${tLocal}
interface ProblemDetails {
  errors?: { pointer: string; message: string; code?: string; params?: Record<string, unknown> }[];
}

export interface ApplyServerErrorsArgs<TPayload, TFormState extends FieldValues> {
  readonly error: unknown;
  readonly setError: UseFormSetError<TFormState>;
  readonly fieldMap: StrictFieldMap<TPayload, TFormState>;
}

/** Where the form-level message of a failed submit is held: react-hook-form's
 *  \`root\` error, which the next submit clears.  \`FormFailure\` renders it. */
export const SUBMIT_FAILURE_ROOT = "root.submit";

export type ServerErrorOutcome = { kind: "fields" } | { kind: "form" };

${PROBLEM_KEY_TS}
/** The localized text of a refusal: its catalog \`code\` (or its aggregate's
 *  own sentence, \`problemKey\`), falling back to the English the server sent,
 *  its placeholders filled from \`params\`.  A message whose placeholders the
 *  params cannot fill keeps the English. */
export function localizeProblem(code: string, fallback: string, params?: Record<string, unknown>): string {
  try {
    return t(problemKey(code, params), fallback, params as Parameters<typeof t>[2]);
  } catch {
    return fallback;
  }
}

${submitFailureTs(i18n)}
/** Show what a failed submit answered: each field error under its field, or
 *  ONE message on the form (\`FormFailure\`); nothing is shown outside it. */
export function applyServerErrors<TPayload, TFormState extends FieldValues>({
  error,
  setError,
  fieldMap,
}: ApplyServerErrorsArgs<TPayload, TFormState>): ServerErrorOutcome {
  const failure = classifySubmitFailure(error);
  if (failure.kind === "form") {
    setError(SUBMIT_FAILURE_ROOT, { type: "server", message: failure.message });
    return { kind: "form" };
  }
  // The generated API client throws an \`ApiError\` carrying the parsed \`body\`
  // (an RFC 7807 ProblemDetails whose \`errors\` the rule found non-empty).
  const pd = (error as { body?: ProblemDetails }).body ?? {};
  for (const { pointer, message, code, params } of pd.errors ?? []) {
    const flatKey = pointerToFlat(pointer);
    const target = (fieldMap as Record<string, string | undefined>)[flatKey] ?? flatKey;
    setError(target as Path<TFormState>, {
      type: "server",
      message: localizeProblem(code ?? "field.rule", message, params),
    });
  }
  return { kind: "fields" };
}

const pointerToFlat = (p: string) =>
  p.startsWith("/") ? p.slice(1).split("/").map(decodeURIComponent).join(".") : p;
`;
}

/** `src/lib/form-failure.tsx` — the one element a form shows for a failed
 *  submit that no field owns (`applyServerErrors` fills `root.submit`).  It is
 *  inside the form, announced as an alert, and gone once the next submit starts
 *  (react-hook-form clears `root` errors then). */
export const REACT_LIB_FORM_FAILURE_TSX = `// Auto-generated.  Do not edit by hand.

export function FormFailure({ error, testid }: { error?: { message?: string }; testid: string }) {
  if (!error?.message) return null;
  return (
    <p role="alert" data-testid={testid} style={{ color: "#c92a2a", margin: 0 }}>
      {error.message}
    </p>
  );
}
`;

/** `src/lib/zod-resolver.ts` — `@hookform/resolvers`' `zodResolver`, keeping
 *  the catalog code a Loom check put on its zod issue (`params.code`) on
 *  the field error it becomes.  The stock resolver keeps only zod's own issue
 *  code, so without this a client-side rule could only render the English
 *  its schema was built with. */
export const REACT_LIB_ZOD_RESOLVER_TS = `// Auto-generated.  Do not edit by hand.
import { zodResolver as baseZodResolver } from "@hookform/resolvers/zod";

interface LoomIssue {
  path: PropertyKey[];
  params?: { ${TS_RUNTIME.issueCode}?: string; ${TS_RUNTIME.issueValues}?: Record<string, unknown> };
}

/** The stock zodResolver, plus each Loom issue's catalog code (\`loomCode\`)
 *  and a field limit's bound (\`loomValues\`) on its field error, so the
 *  error localizes when the form RENDERS
 *  (\`fieldErrorText\`) rather than when the schema was built. */
export const zodResolver = ((schema: any, schemaOptions?: any, resolverOptions?: any) => {
  const resolve = baseZodResolver(schema, schemaOptions, resolverOptions);
  return async (values: any, context: any, options: any) => {
    const result = await resolve(values, context, options);
    if (Object.keys(result.errors).length === 0) return result;
    const parsed = await schema.safeParseAsync(values);
    for (const issue of (parsed.error?.issues ?? []) as LoomIssue[]) {
      const code = issue.params?.${TS_RUNTIME.issueCode};
      if (!code) continue;
      let node: any = result.errors;
      for (const seg of issue.path) node = node?.[seg as string];
      if (node && typeof node === "object" && node.loomCode === undefined) {
        node.loomCode = code;
        if (issue.params?.${TS_RUNTIME.issueValues}) node.loomValues = issue.params.${TS_RUNTIME.issueValues};
      }
    }
    return result;
  };
}) as typeof baseZodResolver;
`;

/** `src/lib/field-error.ts` — the render-time field-error localizer every
 *  React form's error slot calls (`fieldErrorText(errors.foo)`). */
export function reactLibFieldErrorTs(i18n: boolean): string {
  const tSource = i18n
    ? 'import { t } from "../i18n";\n'
    : `
/** No catalog in this app: the English message is the text. */
const t = (_code: string, fallback: string, _params?: Record<string, unknown>): string => fallback;
`;
  return `// Auto-generated.  Do not edit by hand.
${tSource}
/** A field error as react-hook-form holds it, plus the catalog code a Loom
 *  check put on it (\`zod-resolver.ts\`). */
interface LoomFieldError {
  type?: string | number;
  message?: string;
  loomCode?: string;
  /** A field limit's bound (\`{ min: 1 }\`), the values its text names. */
  loomValues?: Record<string, unknown>;
}

/** The zod issue codes that mean the value has the wrong type or shape. */
const TYPE_MISMATCH: ReadonlySet<string> = new Set(["invalid_type", "invalid_value", "invalid_union", "unrecognized_keys"]);

/** A field error's text in the active locale, computed when the form RENDERS:
 *  the issue's catalog code (a Loom check's own, else the field reason its zod
 *  code names), falling back to the English message.  A server error was
 *  localized when it was applied (\`applyServerErrors\`), so it renders as-is. */
export function fieldErrorText(error: unknown): string | undefined {
  const e = error as LoomFieldError | undefined;
  if (!e?.message) return undefined;
  if (e.type === "server") return e.message;
  const code = e.loomCode ?? (TYPE_MISMATCH.has(String(e.type)) ? "field.type-mismatch" : "field.rule");
  try {
    return t(code, e.message, e.loomValues as Parameters<typeof t>[2]);
  } catch {
    return e.message;
  }
}
`;
}

// The Playwright e2e harness scaffolding (fixtures / config /
// package.json / tsconfig) moved to
// `src/generator/_frontend/e2e-harness.ts` — shared with the Svelte
// frontend.  Re-exported so react + system consumers keep this path.
export {
  E2E_FIXTURES_TS,
  E2E_TSCONFIG_JSON,
  e2ePackageJson,
  PLAYWRIGHT_CONFIG_TS,
} from "../_frontend/e2e-harness.js";

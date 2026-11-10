// The OpenAPI documents the playground's `restApi` mock answers from: a
// `storage { type: restApi, config: { baseUrl, spec } }` names its spec either
// inline (a JSON object) or as a workspace file beside the entry.  Pure: the
// caller supplies the file reader.

import type { BuildDiagnostic } from "./protocol.js";

export interface RestSpec {
  /** `scheme://host[:port]` of the storage's `baseUrl`. */
  origin: string;
  /** The parsed OpenAPI document. */
  spec: object;
}

interface RestStorage {
  name: string;
  type: string;
  config?: readonly { key: string; value: { value: string } }[];
}

const warn = (message: string): BuildDiagnostic => ({ severity: "warning", message, source: "loom-playground" });

export function restSpecsOf(
  storages: readonly RestStorage[],
  readFile: (path: string) => string | undefined,
  entryDir: string,
): { specs: RestSpec[]; diagnostics: BuildDiagnostic[] } {
  const specs: RestSpec[] = [];
  const diagnostics: BuildDiagnostic[] = [];
  for (const st of storages) {
    if (st.type !== "restApi") continue;
    const cfg = (k: string): string | undefined => st.config?.find((c) => c.key === k)?.value.value;
    const ref = cfg("spec");
    const baseUrl = cfg("baseUrl");
    if (!ref || !baseUrl) continue;
    let origin: string;
    try {
      origin = new URL(baseUrl).origin;
    } catch {
      continue;
    }
    const inline = ref.trimStart().startsWith("{");
    const text = inline ? ref : readFile(`${entryDir}/${ref}`.replace(/\/+/g, "/"));
    if (text === undefined) {
      diagnostics.push(warn(`storage ${st.name}: spec file "${ref}" is not in the workspace; its mock answers with an echo.`));
      continue;
    }
    try {
      specs.push({ origin, spec: JSON.parse(text) as object });
    } catch {
      diagnostics.push(warn(`storage ${st.name}: spec "${inline ? "(inline)" : ref}" is not valid JSON; its mock answers with an echo.`));
    }
  }
  return { specs, diagnostics };
}

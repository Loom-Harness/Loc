// Reads the OpenAPI contract the generated Java backend declares as source
// annotations: per-method `@ApiResponse` / `@Operation` / `@RequestBody` lines
// under the mapping annotation, and `@Schema(requiredProperties = …)` on
// records.  Pure functions over the generated `Map<path, content>`.

export interface JavaDocumentedRoute {
  /** 2xx statuses, ascending. */
  success: number[];
  /** Statuses >= 400, ascending. */
  errors: number[];
  /** Per error status: simple class names of its `anyOf`, minus ProblemDetails. */
  errorAnyOf: Map<number, string[]>;
  /** Simple class name of the success body, or `array<X>`; undefined when inferred. */
  successSchema?: string;
  operationId?: string;
  /** Simple class name of an explicitly declared request body. */
  requestBody?: string;
}

const MAPPING =
  /^\s*@(Get|Post|Put|Patch|Delete)Mapping\b(?:\(\s*(?:value\s*=\s*|path\s*=\s*)?"([^"]*)")?/;
const simple = (fq: string): string => fq.slice(fq.lastIndexOf(".") + 1);

function joinPath(a: string, b: string): string {
  const j = `${a}/${b}`.replace(/\/+/g, "/");
  return j.length > 1 ? j.replace(/\/$/, "") : j;
}

/** Every documented controller route, keyed `"<method> <full path>"` (lowercase method). */
export function javaDocumentedRoutes(
  files: ReadonlyMap<string, string>,
): Map<string, JavaDocumentedRoute> {
  const routes = new Map<string, JavaDocumentedRoute>();
  for (const [path, content] of files) {
    if (!path.endsWith(".java") || !path.includes("src/main/java")) continue;
    if (!content.includes("@RestController")) continue;
    const src = content.split("\n");
    let prefix = "";
    for (let i = 0; i < src.length; i++) {
      const line = src[i] as string;
      const cls = line.match(/^\s*@RequestMapping\(\s*(?:value\s*=\s*|path\s*=\s*)?"([^"]*)"/);
      if (cls) prefix = cls[1] as string;
      const m = line.match(MAPPING);
      if (!m) continue;
      const method = (m[1] as string).toLowerCase();
      const route: JavaDocumentedRoute = { success: [], errors: [], errorAnyOf: new Map() };
      for (let j = i + 1; j < src.length; j++) {
        const l = src[j] as string;
        if (/^\s*public\b[^;]*\(/.test(l)) break;
        const op = l.match(/annotations\.Operation\(operationId = "([^"]+)"/);
        if (op) route.operationId = op[1];
        const rb = l.match(
          /annotations\.parameters\.RequestBody\(.*?implementation = ([\w.]+)\.class/,
        );
        if (rb) route.requestBody = simple(rb[1] as string);
        const resp = l.match(/annotations\.responses\.ApiResponse\(responseCode = "(\d+)"/);
        if (!resp) continue;
        const status = Number(resp[1]);
        if (status >= 400) {
          route.errors.push(status);
          const any = l.match(/anyOf = \{([^}]*)\}/);
          if (any) {
            const names = (any[1] as string)
              .split(",")
              .map((s) => simple(s.trim().replace(/\.class$/, "")))
              .filter((n) => n !== "ProblemDetails");
            if (names.length > 0) route.errorAnyOf.set(status, names);
          }
        } else {
          route.success.push(status);
          const arr = l.match(/ArraySchema\(schema = @[\w.]+\(implementation = ([\w.]+)\.class/);
          const impl = l.match(/Content\(schema = @[\w.]+\(implementation = ([\w.]+)\.class/);
          if (arr) route.successSchema = `array<${simple(arr[1] as string)}>`;
          else if (impl) route.successSchema = simple(impl[1] as string);
        }
      }
      route.success.sort((a, b) => a - b);
      route.errors.sort((a, b) => a - b);
      routes.set(`${method} ${joinPath(prefix, m[2] ?? "")}`, route);
    }
  }
  if (routes.size === 0) {
    throw new Error("javaDocumentedRoutes: no documented controller routes found");
  }
  return routes;
}

/** Published schema name -> sorted required property names, from record `@Schema`. */
export function javaRequiredSets(files: ReadonlyMap<string, string>): Map<string, string[]> {
  const sets = new Map<string, string[]>();
  for (const [path, content] of files) {
    if (!path.endsWith(".java")) continue;
    const re =
      /@io\.swagger\.v3\.oas\.annotations\.media\.Schema\(([^\n]*)\)\s*\n\s*public (?:record|interface|class) (\w+)/g;
    for (const m of content.matchAll(re)) {
      const args = m[1] as string;
      const req = args.match(/requiredProperties = \{([^}]*)\}/);
      if (!req) continue;
      const name = args.match(/(?:^|, )name = "([^"]+)"/)?.[1] ?? (m[2] as string);
      const fields = [...(req[1] as string).matchAll(/"([^"]+)"/g)]
        .map((x) => x[1] as string)
        .sort();
      sets.set(name, fields);
    }
  }
  if (sets.size === 0) throw new Error("javaRequiredSets: no @Schema(requiredProperties) found");
  return sets;
}

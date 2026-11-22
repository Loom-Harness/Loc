// What a backend's GENERATED tree actually mounts and starts — read from the
// emitted source, one reader per backend.  The entry-surface census
// (`test/system/entry-surface-census.test.ts`) compares this with the plan
// fact `entrySurface` (`src/ir/plan/entry-surface.ts`).
//
// Each reader parses the framework's own route declarations, so a route an
// emitter adds is seen whichever emitter added it:
//
//   node    `X.route("<prefix>", fn(…))` mounts, `createRoute({ method, path })`,
//           `X.get("<path>", …)` and `app.doc("<path>")`, attributed to the
//           exported function they sit in and prefixed by where it is mounted.
//   dotnet  class `[Route("…")]` + action `[HttpGet("…")]`, minimal-API
//           `MapGet("…")`, `MapMetrics()`, `UseSwagger` with its route template.
//   java    class `@RequestMapping("…")` + method `@GetMapping("…")`, the
//           actuator and springdoc paths in `application.yml`.
//   python  `APIRouter(prefix="…")` + `@router.get("…")`, `include_router(x,
//           prefix="…")` through the `import router as x` alias, `@app.get("…")`,
//           FastAPI's default `/openapi.json`.
//   elixir  the Phoenix router's `scope "…"` blocks and their verb lines.
//
// A framework page that documents the api and reads no data (Swagger UI,
// ReDoc) is reported separately as `docPages`, not as a route.

export type MountedBackend = "node" | "dotnet" | "java" | "python" | "elixir";

export interface MountedRoute {
  readonly method: string;
  /** Absolute, `{name}` / `:name` parameters as the framework spells them. */
  readonly path: string;
  /** The emitted file that declares the route. */
  readonly file: string;
}

export interface Mounted {
  readonly routes: MountedRoute[];
  readonly docPages: string[];
}

const VERBS = ["get", "post", "put", "patch", "delete"] as const;

const joinPath = (prefix: string, path: string): string => {
  const p = `${prefix.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  return p.length > 1 ? p.replace(/\/+$/, "") : p;
};

/** The deployable's own files, keyed by their path inside it. */
export function deployableFiles(
  files: ReadonlyMap<string, string>,
  sub: string,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [p, c] of files) if (p.startsWith(`${sub}/`)) out.set(p.slice(sub.length + 1), c);
  return out;
}

export function mountedRoutes(
  backend: MountedBackend,
  files: ReadonlyMap<string, string>,
): Mounted {
  switch (backend) {
    case "node":
      return honoRoutes(files);
    case "dotnet":
      return dotnetRoutes(files);
    case "java":
      return javaRoutes(files);
    case "python":
      return pythonRoutes(files);
    case "elixir":
      return phoenixRoutes(files);
    default: {
      const never: never = backend;
      throw new Error(`no reader for ${String(never)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// node / Hono
// ---------------------------------------------------------------------------

function honoRoutes(files: ReadonlyMap<string, string>): Mounted {
  interface Fn {
    readonly file: string;
    readonly routes: { method: string; path: string }[];
    readonly mounts: { prefix: string; fn: string }[];
  }
  const fns = new Map<string, Fn>();
  const sources = [...files].filter(
    ([p]) =>
      p.endsWith(".ts") && !p.includes("node_modules/") && !/(^|\/)(e2e|test|tests)\//.test(p),
  );
  for (const [file, src] of sources) {
    const starts = [...src.matchAll(/^export (?:async )?function (\w+)\s*\(/gm)];
    starts.forEach((m, i) => {
      const body = src.slice(m.index, starts[i + 1]?.index ?? src.length);
      const routes: { method: string; path: string }[] = [];
      for (const r of body.matchAll(/createRoute\(\{\s*method:\s*"(\w+)",\s*path:\s*"([^"]*)"/g)) {
        routes.push({ method: r[1]!, path: r[2]! });
      }
      for (const r of body.matchAll(
        /\b\w+\.(get|post|put|patch|delete)\(\s*["`]([^"`$]*)["`]\s*,/g,
      )) {
        routes.push({ method: r[1]!, path: r[2]! });
      }
      for (const r of body.matchAll(/\b\w+\.doc(?:31)?\(\s*"([^"]*)"/g)) {
        routes.push({ method: "get", path: r[1]! });
      }
      const mounts = [
        ...body.matchAll(/\b\w+\.route\(\s*["`]([^"`]*)["`]\s*,\s*(?:\w+\.)?(\w+)\(/g),
      ].map((r) => ({ prefix: r[1]!, fn: r[2]! }));
      fns.set(m[1]!, { file, routes, mounts });
    });
  }
  const mountedBy = new Map<string, { prefix: string; parent: string }[]>();
  for (const [name, fn] of fns) {
    for (const m of fn.mounts) {
      const list = mountedBy.get(m.fn) ?? [];
      list.push({ prefix: m.prefix, parent: name });
      mountedBy.set(m.fn, list);
    }
  }
  // The app is the function that serves the OpenAPI document.
  const roots = [...fns].filter(([, f]) => f.routes.some((r) => r.path.endsWith("openapi.json")));
  const routes: MountedRoute[] = [];
  const visit = (name: string, prefix: string, seen: Set<string>): void => {
    if (seen.has(name)) return;
    const fn = fns.get(name);
    if (!fn) return;
    for (const r of fn.routes) {
      routes.push({ method: r.method, path: joinPath(prefix, r.path), file: fn.file });
    }
    for (const m of fn.mounts) visit(m.fn, joinPath(prefix, m.prefix), new Set([...seen, name]));
  };
  for (const [name] of roots) visit(name, "", new Set());
  return { routes, docPages: [] };
}

// ---------------------------------------------------------------------------
// .NET / ASP.NET
// ---------------------------------------------------------------------------

function dotnetRoutes(files: ReadonlyMap<string, string>): Mounted {
  const routes: MountedRoute[] = [];
  const docPages: string[] = [];
  for (const [file, src] of files) {
    if (!file.endsWith(".cs")) continue;
    // Attribute routing: each class's `[Route]` prefixes its actions.
    const classes = [
      ...src.matchAll(
        /^(?:\[[^\n]*\]\s*\n)*(?:public |internal )?(?:sealed |partial |abstract )*class \w+/gm,
      ),
    ];
    classes.forEach((c, i) => {
      const head = c[0];
      const body = src.slice(c.index! + head.length, classes[i + 1]?.index ?? src.length);
      const prefix = /\[Route\("([^"]*)"\)\]/.exec(head)?.[1] ?? "";
      for (const a of body.matchAll(/\[Http(Get|Post|Put|Patch|Delete)(?:\("([^"]*)"\))?\]/g)) {
        const p = a[2] ?? "";
        const path = p.startsWith("/") ? p : joinPath(`/${prefix}`, p);
        routes.push({ method: a[1]!.toLowerCase(), path, file });
      }
    });
    for (const m of src.matchAll(/\.Map(Get|Post|Put|Patch|Delete)\(\s*"([^"]*)"/g)) {
      routes.push({ method: m[1]!.toLowerCase(), path: m[2]!, file });
    }
    if (/\.MapMetrics\(\)/.test(src)) routes.push({ method: "get", path: "/metrics", file });
    const swagger = /UseSwagger\([^)]*RouteTemplate\s*=\s*"([^"]*)"/.exec(src);
    if (swagger) {
      routes.push({
        method: "get",
        path: `/${swagger[1]!.replace("{documentName}", "openapi")}`,
        file,
      });
    }
    if (/\.UseSwaggerUI\(/.test(src)) docPages.push("swagger-ui");
  }
  return { routes, docPages };
}

// ---------------------------------------------------------------------------
// Java / Spring
// ---------------------------------------------------------------------------

function javaRoutes(files: ReadonlyMap<string, string>): Mounted {
  const routes: MountedRoute[] = [];
  const docPages: string[] = [];
  const mappingPath = (args: string | undefined): string => {
    if (!args) return "";
    return /"([^"]*)"/.exec(args)?.[1] ?? "";
  };
  for (const [file, src] of files) {
    if (file.endsWith(".java")) {
      const cls = /(?:^|\n)((?:@\w+(?:\([^)]*\))?\s*\n)*)(?:public )?(?:final )?class \w+/.exec(
        src,
      );
      const prefix = cls ? mappingPath(/@RequestMapping(\([^)]*\))?/.exec(cls[1] ?? "")?.[1]) : "";
      const body = cls ? src.slice(cls.index + cls[0].length) : src;
      for (const m of body.matchAll(/@(Get|Post|Put|Patch|Delete)Mapping(\([^)]*\))?/g)) {
        routes.push({
          method: m[1]!.toLowerCase(),
          path: joinPath(prefix || "/", mappingPath(m[2])),
          file,
        });
      }
    }
    if (file.endsWith("application.yml")) {
      if (/path-mapping:\s*\n\s*prometheus:\s*metrics/.test(src)) {
        routes.push({ method: "get", path: "/metrics", file });
      }
      const docs = /api-docs:\s*\n\s*path:\s*(\S+)/.exec(src);
      if (docs) routes.push({ method: "get", path: docs[1]!, file });
      if (/swagger-ui:\s*\n\s*enabled:/.test(src)) docPages.push("swagger-ui");
    }
  }
  return { routes, docPages };
}

// ---------------------------------------------------------------------------
// Python / FastAPI
// ---------------------------------------------------------------------------

function pythonRoutes(files: ReadonlyMap<string, string>): Mounted {
  const routes: MountedRoute[] = [];
  const docPages: string[] = [];
  const main = [...files].find(([p]) => p.endsWith("app/main.py"));
  if (!main) return { routes, docPages };
  const [mainFile, mainSrc] = main;
  const moduleFile = (mod: string): string | undefined => {
    const want = `${mod.replace(/\./g, "/")}.py`;
    return [...files.keys()].find((p) => p === want || p.endsWith(`/${want}`));
  };
  const aliases = new Map<string, string>();
  for (const m of mainSrc.matchAll(/^from ([\w.]+) import router as (\w+)/gm)) {
    aliases.set(m[2]!, m[1]!);
  }
  const routerRoutes = (src: string): { method: string; path: string }[] => {
    const prefix = /^router = APIRouter\(([^)]*)\)/m.exec(src)?.[1];
    const pre = prefix ? (/prefix="([^"]*)"/.exec(prefix)?.[1] ?? "") : "";
    return [...src.matchAll(/^\s*@router\.(get|post|put|patch|delete)\(\s*"([^"]*)"/gm)].map(
      (m) => ({
        method: m[1]!,
        path: joinPath(pre || "/", m[2]!),
      }),
    );
  };
  for (const m of mainSrc.matchAll(/app\.include_router\((\w+)(?:,\s*prefix="([^"]*)")?/g)) {
    const mod = aliases.get(m[1]!);
    const file = mod ? moduleFile(mod) : undefined;
    if (!file) continue;
    for (const r of routerRoutes(files.get(file)!)) {
      routes.push({ method: r.method, path: joinPath(m[2] ?? "/", r.path), file });
    }
  }
  for (const m of mainSrc.matchAll(
    /^\s*@app\.(get|post|put|patch|delete|api_route)\(\s*"([^"]*)"/gm,
  )) {
    routes.push({ method: m[1]!, path: m[2]!, file: mainFile });
  }
  const openapiUrl = /openapi_url="([^"]*)"/.exec(mainSrc)?.[1] ?? "/openapi.json";
  routes.push({ method: "get", path: openapiUrl, file: mainFile });
  if (/docs_url=/.test(mainSrc)) docPages.push("docs");
  if (/redoc_url=/.test(mainSrc)) docPages.push("redoc");
  return { routes, docPages };
}

// ---------------------------------------------------------------------------
// Elixir / Phoenix
// ---------------------------------------------------------------------------

function phoenixRoutes(files: ReadonlyMap<string, string>): Mounted {
  const routes: MountedRoute[] = [];
  const router = [...files].find(([p]) => /_web\/router\.ex$/.test(p));
  if (!router) return { routes, docPages: [] };
  const [file, src] = router;
  const stack: string[] = [];
  const kinds: ("scope" | "block")[] = [];
  for (const raw of src.split("\n")) {
    const line = raw.trim();
    const scope = /^scope\s+"([^"]*)"/.exec(line);
    if (scope) {
      stack.push(scope[1]!);
      kinds.push("scope");
      continue;
    }
    if (/\bdo$/.test(line)) {
      kinds.push("block");
      continue;
    }
    if (line === "end") {
      if (kinds.pop() === "scope") stack.pop();
      continue;
    }
    const verb = /^(get|post|put|patch|delete)\s+"([^"]*)"/.exec(line);
    if (verb && stack.length > 0) {
      routes.push({
        method: verb[1]!,
        path: joinPath(stack.reduce(joinPath, "/"), verb[2]!),
        file,
      });
    }
  }
  return { routes, docPages: [] };
}

export const MOUNTED_VERBS = VERBS;

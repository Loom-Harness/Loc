// Render fidelity: the Spring controller's mappings AND their OpenAPI
// `@ApiResponse` annotations render EXACTLY the derived surface.
//
// The java sibling of `test/generator/dotnet/api-surface-render.test.ts` (see
// its header for the framing).  springdoc reads each method's error statuses
// off its `@ApiResponse` annotations, so java's PUBLISHED contract is those
// annotations.  Both the mapping (what a request matches) and the annotations
// (what the served spec claims) render from `deriveAggregateOperations`; this
// suite scrapes both and holds them to the derivation, so a renderer defect on
// either side fails here.
//
// The fixture runs under `urlStyle: resource`, which pins the java-only fix
// this slice shipped: java was the only backend ignoring `routeSlug`, so a
// resource-styled op mounted at `/{id}/cancel` while the other four (and
// every generated client) used `/{id}/cancels`.  With the fixture styled,
// a regression to `snake(op.name)` breaks the mount-set equality below.

import { describe, expect, it } from "vitest";
import type { BoundedContextIR, LoomModel } from "../../../src/ir/types/loom-ir.js";
import { deriveContextOperations } from "../../../src/ir/util/api-surface.js";
import { generateSystemFiles, generateSystemFilesUnchecked } from "../../_helpers/generate.js";
import { buildLoomModel } from "../../_helpers/ir.js";

const SOURCE = `
system P {
  subdomain D {
    context Orders {
      error Missing { resource: string }
      aggregate Order with crudish {
        code: string
        status: string
        operation cancel() when status == "Open" { status := "Cancelled" }
      }
      repository Orders for Order { }
      criterion OrdersByCode(code: string) of Order = this.code == code
      criterion OrdersByRef(ref: string) of Order = this.code == ref
      policy { read Order requires currentUser.role == "admin" }
    }
  }
  api SalesApi from D { urlStyle: resource }
  user { id: string  role: string }
  storage pg { type: postgres }
  resource st { for: Orders, kind: state, use: pg }
  deployable d {
    platform: java
    contexts: [Orders]
    dataSources: [st]
    port: 3000
    auth: required
  }
}
`;

interface Route {
  readonly method: string;
  readonly path: string;
}
const key = (r: Route): string => `${r.method.toLowerCase()} ${r.path}`;

function normalisePath(p: string): string {
  const trimmed = p.replace(/\/+$/, "");
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function controllerSource(files: Map<string, string>): { src: string; base: string } {
  const src =
    [...files].find(
      ([p, c]) => p.endsWith(".java") && /@RequestMapping\("\/api\/orders"\)/.test(c),
    )?.[1] ?? "";
  return { src, base: src.match(/@RequestMapping\("([^"]*)"\)/)?.[1] ?? "" };
}

/** Class `@RequestMapping("<base>")` + method `@<M>Mapping[("<p>")]` — a BARE
 *  annotation mounts at the class path itself (create / findAll). */
function scrapeControllerRoutes(files: Map<string, string>): Route[] {
  const { src, base } = controllerSource(files);
  const out: Route[] = [];
  for (const m of src.matchAll(/@(Get|Post|Put|Patch|Delete)Mapping(?:\("([^"]*)"\))?/g)) {
    out.push({ method: m[1]!, path: normalisePath(`${base}${m[2] ?? ""}`) });
  }
  return out;
}

/** Each mapping's published error statuses — the `@ApiResponse(responseCode
 *  = "4xx"/"5xx")` annotations between the mapping and its method signature:
 *  java's published contract. */
function scrapeDocumentedRoutes(files: Map<string, string>): Map<string, number[]> {
  const { src, base } = controllerSource(files);
  const out = new Map<string, number[]>();
  let current: string | undefined;
  for (const line of src.split("\n")) {
    const m = line.match(/@(Get|Post|Put|Patch|Delete)Mapping(?:\("([^"]*)"\))?/);
    if (m) {
      current = key({ method: m[1]!, path: normalisePath(`${base}${m[2] ?? ""}`) });
      out.set(current, []);
      continue;
    }
    if (current && /^\s*public /.test(line)) {
      current = undefined;
      continue;
    }
    const code = line.match(/ApiResponse\(responseCode = "(\d{3})"/)?.[1];
    if (current && code && Number(code) >= 400) out.get(current)!.push(Number(code));
  }
  for (const codes of out.values()) codes.sort((a, b) => a - b);
  return out;
}

function ordersContext(model: LoomModel): BoundedContextIR {
  const ctx = model.systems
    .flatMap((s) => s.subdomains)
    .flatMap((sd) => sd.contexts)
    .find((c) => c.name === "Orders");
  expect(ctx, "Orders context lowered").toBeDefined();
  return ctx!;
}

function derivedKeys(model: LoomModel): string[] {
  return deriveContextOperations(ordersContext(model))
    .map((o) => key({ method: o.method, path: o.path }))
    .sort();
}

describe("java render fidelity — mappings + @ApiResponse render exactly the derived surface", () => {
  it("the controller mounts exactly the derived method+path set (routeSlug honored)", async () => {
    const model = await buildLoomModel(SOURCE);
    const files = await generateSystemFiles(SOURCE);
    const mounted = scrapeControllerRoutes(files).map(key).sort();
    expect(mounted.length, "scraped no routes — the scraper is stale").toBeGreaterThan(0);
    expect(mounted).toEqual(derivedKeys(model));
    // The resource-styled op mounts at its routeSlug — the java-only fix.
    expect(mounted).toContain("post /api/orders/{id}/cancels");
    expect(mounted).toContain("get /api/orders/{id}/can_cancels");
  });

  it("the annotations publish exactly the derived paths with exactly op.errorStatuses", async () => {
    const model = await buildLoomModel(SOURCE);
    const derived = deriveContextOperations(ordersContext(model));
    const published = scrapeDocumentedRoutes(await generateSystemFiles(SOURCE));
    expect(published.size, "scraped no routes — the scraper is stale").toBeGreaterThan(0);
    for (const op of derived) {
      const k = key({ method: op.method, path: op.path });
      expect(published.get(k), k).toEqual([...op.errorStatuses]);
    }
    // No published aggregate route outside the derived set (workflow routes
    // would be, but this fixture declares none).
    expect([...published.keys()].sort()).toEqual(derivedKeys(model));
  });

  it("a named-only destroy mounts no generic DELETE and documents none", async () => {
    // NAMED FIX (ii): java gated DELETE on `destroys.length > 0`, so a
    // named-only destroy (`destroy archive()`) mounted a generic DELETE that
    // its own document did not describe.  Both sides gate on the shared
    // `emitsRestDestroy` (canonical destroy only).
    const src = `
system P {
  subdomain D {
    context Orders {
      aggregate Order {
        code: string
        status: string
        create(code: string) { }
        destroy archive() { status := "archived" }
      }
      repository Orders for Order { }
    }
  }
  storage pg { type: postgres }
  resource st { for: Orders, kind: state, use: pg }
  deployable d { platform: java contexts: [Orders] dataSources: [st] port: 3000 }
}
`;
    // Deliberately invalid: a named-only destroy is refused outright by
    // `loom.named-lifecycle-dropped` (it reaches no backend).  That refusal IS
    // the premise here — this pins that the emitter ALSO stops mounting a
    // generic DELETE for it, so the two halves agree instead of one shipping a
    // route the other says cannot exist.
    const files = await generateSystemFilesUnchecked(
      src,
      "a named-only destroy is refused by loom.named-lifecycle-dropped; the " +
        "emitter's behaviour under that refusal is exactly what this pins",
    );
    const mounted = scrapeControllerRoutes(files).map(key);
    expect(mounted.some((k) => k.startsWith("delete "))).toBe(false);
    const published = [...scrapeDocumentedRoutes(files).keys()];
    expect(published.some((k) => k.startsWith("delete "))).toBe(false);
  });
});

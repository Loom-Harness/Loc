// Node/Hono read-mask serializer (`mask unless`, authorization.md §5,
// M-T3.2 item 6). The emitter machinery is exercised in isolation (the feature
// is still compile-gated end-to-end via `loom.field-mask-unsupported`, so a full
// generated project can't yet reach it): lower + enrich a `mask unless` model,
// then assert the wire projection carries the predicate and the emitters produce
// the fail-closed `toWireMasked` + a nullable response field.

import { describe, expect, it } from "vitest";
import {
  aggHasFieldMask,
  maskedWireFields,
  toWireMaskedMethod,
} from "../../src/generator/typescript/repository-wire-builder.js";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { forApiRead, wireFieldsFor } from "../../src/ir/enrich/wire-projection.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import type { EnrichedAggregateIR } from "../../src/ir/types/loom-ir.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { javaRequiredSets } from "../_helpers/java-openapi-annotations.js";
import { parseString } from "../_helpers/parse.js";

const SRC = `system S {
  user { id: string  role: string  permissions: string[] }
  subdomain M {
    permissions { unmask }
    context C {
      aggregate P with crudish {
        name: string
        salary: decimal mask unless currentUser.permissions.contains(permissions.unmask)
      }
    }
  }
  storage db { type: postgres }
  resource st { for: C, kind: state, use: db }
  deployable api { platform: node  contexts: [C]  dataSources: [st]  port: 8080  auth: required }
}`;

async function maskedAgg(): Promise<EnrichedAggregateIR> {
  const { model } = await parseString(SRC, { validate: false });
  const ir = enrichLoomModel(lowerModel(model));
  for (const s of ir.systems)
    for (const sd of s.subdomains)
      for (const c of sd.contexts) {
        const p = c.aggregates.find((a) => a.name === "P");
        if (p) return p as EnrichedAggregateIR;
      }
  throw new Error("aggregate P not found");
}

describe("mask unless — node wire serializer", () => {
  it("propagates maskUnless onto the wire field", async () => {
    const agg = await maskedAgg();
    const salary = forApiRead(wireFieldsFor(agg)).find((wf) => wf.name === "salary");
    expect(salary?.maskUnless).toBeDefined();
    // A non-masked field carries no predicate.
    const name = forApiRead(wireFieldsFor(agg)).find((wf) => wf.name === "name");
    expect(name?.maskUnless).toBeUndefined();
  });

  it("aggHasFieldMask / maskedWireFields detect the masked field", async () => {
    const agg = await maskedAgg();
    expect(aggHasFieldMask(agg)).toBe(true);
    expect(maskedWireFields(agg).map((wf) => wf.name)).toEqual(["salary"]);
  });

  it("emits a fail-closed toWireMasked that redacts the field unless the predicate holds", async () => {
    const agg = await maskedAgg();
    const method = toWireMaskedMethod(agg);
    expect(method).toContain("toWireMasked(root: P, currentUser: User | null)");
    // fail-closed: null caller OR failed predicate → redact to null.
    expect(method).toContain("currentUser !== null");
    expect(method).toContain('(currentUser.permissions).includes("m.unmask")');
    expect(method).toContain("wire.salary = null");
  });
});

describe("mask unless — node response schema", () => {
  it("admits the redacted null as `.nullish()`, so the field is not in the OpenAPI required set", async () => {
    const src = SRC.replace("  storage db", "  api A from M\n  storage db").replace(
      "port: 8080",
      "serves: A  port: 8080",
    );
    const files = await generateSystemFiles(src);
    const routes = [...files.entries()].find(([p]) => p.endsWith("http/p.routes.ts"))?.[1];
    expect(routes).toBeDefined();
    // Every backend leaves a nullable response property out of `required`; a
    // `.nullable()` (present-but-null) spelling would keep it required on node.
    expect(routes).toContain("salary: z.number().nullish(),");
    expect(routes).not.toMatch(/salary: z\.number\(\)\.nullable\(\)/);
  });
});

describe("mask unless — the response required set agrees on every backend", () => {
  const served = (platform: string): string =>
    SRC.replace("  storage db", "  api A from M\n  storage db")
      .replace("platform: node", `platform: ${platform}`)
      .replace("port: 8080", "serves: A  port: 8080");
  const fileEnding = (files: Map<string, string>, suffix: string): string => {
    const hit = [...files.entries()].find(([p]) => p.endsWith(suffix));
    expect(hit, suffix).toBeDefined();
    return hit![1];
  };

  it("java leaves the masked field out of the response's required set", async () => {
    const files = await generateSystemFiles(served("java"));
    const req = javaRequiredSets(files).get("PResponse");
    expect(req).toBeDefined();
    expect(req).toContain("name");
    expect(req).not.toContain("salary");
  });

  it("phoenix leaves the masked field out of the response's required set", async () => {
    const files = await generateSystemFiles(served("elixir"));
    const schema = fileEnding(files, "api/schemas/p_response.ex");
    const req = schema.split("\n").find((l) => l.trim().startsWith("required:"));
    expect(req).toContain(":name");
    expect(req).not.toContain(":salary");
  });
});

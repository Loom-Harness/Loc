import { describe, expect, it } from "vitest";
import { hasMarkers, ref } from "../../../src/generator/_imports/symbol.js";
import {
  finalizeTsModule,
  hasSlots,
  refType,
  tsDefault,
  tsImportSlot,
  tsNamed,
  tsNamespace,
  tsSpecifier,
} from "../../../src/generator/_imports/ts.js";
import { generateCorpusCase } from "../../fixtures/corpus/harness.js";

// Imports derived from use — the TypeScript finalizer.

const mod = (...lines: string[]): string => lines.join("\n");
const Decimal = tsDefault("decimal.js", "Decimal");
const Ids = tsNamespace("~/domain/ids", "Ids");
const NotFound = tsNamed("~/domain/errors", "AggregateNotFoundError");
const Conflict = tsNamed("~/domain/errors", "ConcurrencyError");

describe("finalizeTsModule", () => {
  it("leaves a module with no marker and no slot untouched", () => {
    const src = mod("// x", 'import { a } from "b";', "", "export const c = a;", "");
    expect(finalizeTsModule(src, { path: "http/x.ts" })).toBe(src);
  });

  it("derives a line per referenced module after the leading imports", () => {
    const out = finalizeTsModule(
      mod(
        "// Auto-generated.",
        'import { z } from "zod";',
        "",
        `const n = new ${ref(Decimal)}(1); const i: ${refType(Ids)}.OrderId = x;`,
        "",
      ),
      { path: "db/repositories/order-repository.ts" },
    );
    expect(out).toBe(
      mod(
        "// Auto-generated.",
        'import { z } from "zod";',
        'import type * as Ids from "../../domain/ids";',
        'import Decimal from "decimal.js";',
        "",
        "const n = new Decimal(1); const i: Ids.OrderId = x;",
        "",
      ),
    );
  });

  it("places a module at its slot, in the slot's order, and drops unused slots", () => {
    const out = finalizeTsModule(
      mod(
        tsImportSlot("decimal.js"),
        tsImportSlot("~/domain/errors", { order: ["AggregateNotFoundError", "ConcurrencyError"] }),
        'import { z } from "zod";',
        "",
        `throw new ${ref(Conflict)}(); throw new ${ref(NotFound)}();`,
      ),
      { path: "http/order.routes.ts" },
    );
    expect(out).toBe(
      mod(
        'import { AggregateNotFoundError, ConcurrencyError } from "../domain/errors";',
        'import { z } from "zod";',
        "",
        "throw new ConcurrencyError(); throw new AggregateNotFoundError();",
      ),
    );
  });

  it("a value reference anywhere makes the binding a value import; mixed lines inline `type`", () => {
    const A = tsNamed("~/domain/value-objects", "Money");
    const B = tsNamed("~/domain/value-objects", "Status");
    const out = finalizeTsModule(
      mod(tsImportSlot("~/domain/value-objects"), "", `${refType(A)} ${ref(A)} ${refType(B)}`),
      { path: "domain/order.ts" },
    );
    expect(out.split("\n")[0]).toBe('import { Money, type Status } from "./value-objects";');
  });

  it("inlineType keeps `{ type X }` for an all-type import", () => {
    const D = tsNamed("~/domain/events", "DomainEventDispatcher");
    const out = finalizeTsModule(
      mod(tsImportSlot("~/domain/events", { inlineType: true }), `${refType(D)}`),
      { path: "http/routes.ts" },
    );
    expect(out.split("\n")[0]).toBe(
      'import { type DomainEventDispatcher } from "../domain/events";',
    );
  });

  it("exclusive slots split one module across lines", () => {
    const V = tsNamed("~/domain/value-objects", "Money");
    const E = tsNamed("~/domain/value-objects", "Status");
    const out = finalizeTsModule(
      mod(
        tsImportSlot("~/domain/value-objects", { order: ["Money"], exclusive: true }),
        tsImportSlot("~/domain/value-objects"),
        `${refType(E)} ${refType(V)}`,
      ),
      { path: "domain/events.ts" },
    );
    expect(out.split("\n").slice(0, 2)).toEqual([
      'import type { Money } from "./value-objects";',
      'import type { Status } from "./value-objects";',
    ]);
  });

  it("a binding a hand-written import provides gets no second line", () => {
    const out = finalizeTsModule(mod("import * as Ids from './ids';", `${ref(Ids)}.x`), {
      path: "domain/order.ts",
    });
    expect(out).toBe(mod("import * as Ids from './ids';", "Ids.x"));
  });

  it("a module's own symbols are bare and unimported", () => {
    const out = finalizeTsModule(`new ${ref(NotFound)}()`, { path: "domain/errors.ts" });
    expect(out).toBe("new AggregateNotFoundError()");
  });

  it("two modules binding one name is an error", () => {
    expect(() =>
      finalizeTsModule(`${ref(tsNamed("a", "X"))} ${ref(tsNamed("b", "X"))}`, { path: "x.ts" }),
    ).toThrow(/two imports bind 'X'/);
  });

  it("computes relative specifiers from the importing path", () => {
    expect(tsSpecifier("~/domain/ids", "index.ts")).toBe("./domain/ids");
    expect(tsSpecifier("~/domain/ids", "domain/order.ts")).toBe("./ids");
    expect(tsSpecifier("~/db/schema", "db/repositories/x.ts")).toBe("../schema");
    expect(tsSpecifier("hono/http-exception", "http/x.ts")).toBe("hono/http-exception");
  });
});

describe("the node backend finalizes every module it emits", () => {
  it.each([
    "core-domain",
    "auth-oidc",
    "channels-broker",
    "saga",
    "projection-join",
  ])("%s: every .ts is marker- and slot-free", async (feature) => {
    const files = await generateCorpusCase(feature, "node");
    const modules = [...files].filter(([p]) => p.endsWith(".ts"));
    expect(modules.length).toBeGreaterThan(10);
    const off = modules.filter(([, c]) => hasMarkers(c) || hasSlots(c)).map(([p]) => p);
    expect(off).toEqual([]);
  });
});

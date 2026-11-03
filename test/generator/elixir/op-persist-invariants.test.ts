// An elixir operation persist is `change(%{}) |> force_change(…)` — a changeset
// that never passes through `base_changeset`, where the native single-field
// validators (`validate_number(:qty, greater_than_or_equal_to: 0)`) live.  It
// must re-run BOTH halves of the invariant floor before the write, or
// `setQty(-1)` under `invariant qty >= 0` commits.  Covered on all three op
// persist shapes: a plain named op, a returning op, an extern op.
//
// Also pinned: the context-nested ExUnit integration test keys an op call's
// POSITIONAL arguments by the op's parameter names (`%{"n" => -1}`) — the
// facade reads `Map.get(params, "n")`, so `%{}` ran the op with `nil` and the
// `assert {:error, _}` passed for the wrong reason.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const CORPUS = path.resolve(__dirname, "../../fixtures/corpus");
const corpus = (name: string): string =>
  fs.readFileSync(path.join(CORPUS, `${name}.ddd`), "utf8").replaceAll("__PLATFORM__", "elixir");

const file = (files: Map<string, string>, suffix: string): string => {
  const k = [...files.keys()].find((p) => p.endsWith(suffix));
  expect(k, `${suffix} not emitted`).toBeDefined();
  return files.get(k!)!;
};

/** The body of one emitted `def <name>(` up to its closing top-level `end`. */
const defBody = (src: string, name: string): string => {
  const at = src.indexOf(`  def ${name}(`);
  expect(at, `no def ${name}`).toBeGreaterThanOrEqual(0);
  return src.slice(at, src.indexOf("\n  end\n", at));
};

const CONTEXT_TEST = `test "an operation cannot break a single-field invariant" {
        let c = Counter.create(qty: 1)
        c.setQty(2)
        expect(c.qty).toBe(2)
        expect(c.setQty(-1)).toThrow()
        expect(c.rename("x")).toThrow()
      }`;

const source = (invariant: string, TESTS: string): string => `system T {
  subdomain S {
    context C {
      aggregate Counter {
        qty: int
        ${invariant}
        create(qty: int) { qty := qty }
        operation setQty(n: int) { qty := n }
        operation setQtyAndRead(n: int): int {
          qty := n
          return qty
        }
        operation bumpExtern() extern { }
        operation rename(l: string) { }
      }
      repository Counters for Counter { }
      ${TESTS}
    }
  }
  api A from S
  storage primary { type: postgres }
  resource cs { for: C, kind: state, use: primary }
  deployable e { platform: elixir  contexts: [C]  dataSources: [cs]  serves: A  port: 4000 }
}`;

describe("elixir operation persist re-runs single-field invariants (E11)", () => {
  it("the changeset module exposes the native single-field validators as validate_field_invariants/1", async () => {
    const cs = file(
      await generateSystemFiles(corpus("op-persist-field-invariant")),
      "counter_changeset.ex",
    );
    const fn = defBody(cs, "validate_field_invariants");
    expect(fn).toContain("validate_number(:qty, greater_than_or_equal_to: 0");
  });

  it("every operation persist shape pipes through it before the write", async () => {
    const ctx = file(await generateSystemFiles(source("invariant qty >= 0", "")), "lib/e/c.ex");
    for (const op of ["set_qty_counter", "set_qty_and_read_counter", "bump_extern_counter"]) {
      const body = defBody(ctx, op);
      const pipe = body.indexOf("CounterChangeset.validate_field_invariants()");
      expect(pipe, `${op} skips the single-field invariants`).toBeGreaterThan(0);
      expect(pipe, `${op} validates only after the write`).toBeLessThan(
        body.indexOf("persist_change"),
      );
    }
  });

  it("an aggregate with no single-field invariant gets no pipe", async () => {
    const files = await generateSystemFiles(source("", ""));
    expect(file(files, "lib/e/c.ex")).not.toContain("validate_field_invariants");
    expect(file(files, "counter_changeset.ex")).not.toContain("validate_field_invariants");
  });
});

describe("elixir context integration test keys op arguments by parameter name (E12)", () => {
  it('renders c.setQty(-1) as %{"n" => -1}', async () => {
    const t = file(
      await generateSystemFiles(source("invariant qty >= 0", CONTEXT_TEST)),
      "c_integration_test.exs",
    );
    expect(t).toContain('{:ok, c} = E.C.set_qty_counter(c, %{"n" => 2})');
    expect(t).toContain('assert {:error, _} = E.C.set_qty_counter(c, %{"n" => -1})');
    expect(t).toContain('assert {:error, _} = E.C.rename_counter(c, %{"l" => "x"})');
  });
});

describe("elixir audit / provenance `at` is the millisecond instant (E4, RS-38)", () => {
  it("the audit record types and stamps `at` through Loom.Datetime", async () => {
    const files = await generateSystemFiles(corpus("audit-history"));
    const audit = [...files.entries()].find(([, v]) => v.includes('schema "audit_records"'))?.[1];
    expect(audit, "no audit record schema").toBeDefined();
    expect(audit).toContain("field :at, Loom.Datetime");
    expect(audit).toContain("at: Loom.Datetime.normalize(DateTime.utc_now())");
    expect(audit).not.toMatch(/:at, :utc_datetime|DateTime\.truncate\(:second\)/);
  });

  it("the provenance record types and stamps `at` through Loom.Datetime", async () => {
    const files = await generateSystemFiles(corpus("provenance"));
    const prov = [...files.entries()].find(([, v]) =>
      v.includes('schema "provenance_records"'),
    )?.[1];
    expect(prov, "no provenance record schema").toBeDefined();
    expect(prov).toContain("field :at, Loom.Datetime");
    expect(prov).toContain("now = Loom.Datetime.normalize(DateTime.utc_now())");
  });
});

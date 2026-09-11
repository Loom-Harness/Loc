// RS-26 on the WORKFLOW body (wave C0 schemathesis hand-off, follow-up slice 2).
//
// `dto.ts` boxes an OPERATION's required params — a primitive record component
// cannot express absence, so Jackson binds a missing `int qty` to `0` and a
// missing `boolean flag` to `false`, and the operation runs on a value the
// caller never sent.  The workflow Request record was left unboxed with the
// comment "a PRIMITIVE component gets no @NotNull — it can never be null":
// true of the annotation, but the conclusion skipped the boxing that makes the
// annotation possible in the first place.
//
// Emitted before:
//
//     public record TopUpRequest(int qty, boolean flag, @NotNull String note) {}
//     new RequiredSet("TopUpRequest", List.of("flag", "note", "qty"))
//
// The published contract claimed all three required; the DTO could enforce one.
// An omitted `qty` ran the workflow with `0`, and an explicit `null` failed
// deserialization (Jackson 3 enables FAIL_ON_NULL_FOR_PRIMITIVES) instead of
// reaching the `@Valid` walk that answers 422.
//
// The create body is the deliberate exception and stays unboxed: it applies
// declared defaults, so absence there means "the default" (RS-6) — which is
// the half RS-26 exists to distinguish from an update/command.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

/** Every param kind in one command workflow: the boxable primitives, the ones
 *  already reference-typed, an optional, and a value object. */
const SRC = `system S { subdomain Core { context Wallet {
  valueobject Money { amount: decimal  currency: string }
  enum Tier { Gold, Silver }
  aggregate Account with crudish {
    holder: string
    balance: int
    active: bool
  }
  repository Accounts for Account { }
  workflow topUp {
    create(holder: string, qty: int, serial: long, flag: bool, ratio: decimal, at: datetime, tier: Tier, amount: Money, memo: string?) {
      let acct = Account.create({ holder: holder, balance: qty, active: flag })
    }
  }
} } api A from Core  storage pg { type: postgres }
  resource walletState { for: Wallet, kind: state, use: pg }
  deployable api { platform: java  contexts: [Wallet]  serves: A  dataSources: [walletState]  port: 8080 } }`;

function fileEndingWith(files: Map<string, string>, suffix: string): string {
  const hit = [...files.entries()].find(([k]) => k.endsWith(suffix))?.[1];
  expect(hit, `${suffix} not emitted`).toBeDefined();
  return hit!;
}

/** The record's component list, split on top-level commas (no generics here). */
function components(record: string): string[] {
  const m = /public record TopUpRequest\(([\s\S]*?)\) \{/.exec(record);
  expect(m, "no `public record TopUpRequest(...)`").not.toBeNull();
  return m![1]!.split(", ").map((c) => c.trim());
}

describe("java workflow request DTO — RS-26 boxing of primitive params", () => {
  it("boxes every required primitive and annotates it @NotNull", async () => {
    const comps = components(fileEndingWith(await generateSystemFiles(SRC), "TopUpRequest.java"));
    expect(comps).toContain("@NotNull Integer qty");
    expect(comps).toContain("@NotNull Long serial");
    expect(comps).toContain("@NotNull Boolean flag");
    // The exact shape of the defect: an unboxed component takes Jackson's zero
    // value for an absent key, so absence becomes a legal value.
    for (const prim of ["int ", "long ", "boolean ", "double "]) {
      expect(
        comps.some((c) => c.includes(prim)),
        `an unboxed \`${prim.trim()}\` component cannot express an absent key`,
      ).toBe(false);
    }
  });

  it("leaves the already-reference-typed params as they were", async () => {
    const comps = components(fileEndingWith(await generateSystemFiles(SRC), "TopUpRequest.java"));
    expect(comps).toContain("@NotNull String holder");
    expect(comps).toContain("@NotNull BigDecimal ratio");
    // datetime crosses the wire as a string (parsed at the boundary, F19).
    expect(comps).toContain("@NotNull String at");
    expect(comps).toContain("@NotNull Tier tier");
    // A nested record gets @Valid so the walk DESCENDS into it.
    expect(comps).toContain("@NotNull @Valid MoneyRequest amount");
  });

  it("leaves an OPTIONAL param unannotated — absence is its declared meaning", async () => {
    const comps = components(fileEndingWith(await generateSystemFiles(SRC), "TopUpRequest.java"));
    expect(comps).toContain("String memo");
    expect(comps).not.toContain("@NotNull String memo");
  });

  it("the DTO can now enforce exactly what the published contract requires", async () => {
    const files = await generateSystemFiles(SRC);
    const comps = components(fileEndingWith(files, "TopUpRequest.java"));
    const customizer = fileEndingWith(files, "OpenApiContractCustomizer.java");
    const m = /new RequiredSet\("TopUpRequest", List\.of\(([^)]*)\)\)/.exec(customizer);
    expect(m, "no RequiredSet for TopUpRequest").not.toBeNull();
    const required = m![1]!.split(",").map((s) => s.trim().replace(/"/g, ""));
    // Every field the spec publishes as required is a component the record can
    // detect the absence of — the two halves that disagreed before.
    for (const name of required) {
      const comp = comps.find((c) => c.endsWith(` ${name}`));
      expect(comp, `no component for required field ${name}`).toBeDefined();
      expect(comp, `${name} is published required but carries no @NotNull`).toContain("@NotNull");
      // …and the annotation has to be able to FIRE.  `@NotNull int qty` reads
      // as a guard and is inert: a primitive is never null, so the missing key
      // became `0` and the requirement the spec published was unenforceable.
      const declaredType = comp!.replace(/@\w+\s+/g, "").split(" ")[0]!;
      expect(
        declaredType[0],
        `${name} is published required but its type \`${declaredType}\` cannot be null`,
      ).toBe(declaredType[0]!.toUpperCase());
    }
  });

  it("does NOT apply the rule to the aggregate create body — that one is RS-6's", async () => {
    const create = fileEndingWith(await generateSystemFiles(SRC), "CreateAccountRequest.java");
    // A required create input stays a bare primitive: absence is not a thing
    // the create body has to distinguish, because construction is what it does.
    expect(create).toMatch(/\bint balance\b/);
    // …and where the create body DOES box (`bool` carries an implicit default,
    // so the key is omittable), it stays unannotated — an absent `active` means
    // "the declared default", the exact inverse of the workflow/operation rule.
    expect(create).toMatch(/\bBoolean active\b/);
    expect(create).not.toMatch(/@NotNull\s+Boolean active/);
  });
});

// F31/F32/F33 — the three java escapes the Schemathesis leg was still red on
// (schemathesis.yml, 0/20 first-attempt pass; register:
// docs/audits/schemathesis-findings-2026-08.md).  All three are one sentence:
// the wire boundary answered a 500 for a body its OWN published contract
// already describes.
//
// Measured on booted Spring apps of `web/src/examples/storefront-system.ddd`
// re-platformed to java, before and after:
//
//   request                                                        before  after
//   POST /api/wallets      {…, "balance": omitted}                  500     422
//   POST /api/wallets/{id}/debit  {}                                500     422
//   POST /api/wallets/{id}/debit  {"amount":{"currency":""}}         500     422
//   POST /api/orders/{id}/add_line {"qty": null, …}                 500     422
//   POST /api/workflows/checkout  {…, "unitPrice": omitted}          500     422
//   POST /api/customers    (a valid body)                           201     201
//                          …and 201 is now DECLARED, not just answered.
//
// ── F31: the invariant validator dereferenced values it was not guarding ──
// F23 established the rule — the emitted Spring `Validator` runs ALONGSIDE the
// record's own `@NotNull`, never after it, so a null operand reaches the
// predicate first and a null must SKIP its bound rather than be dereferenced.
// It was applied to two thirds of the emitter:
//   • the single-field arms asked the PATTERN whether the slot was nullable
//     (`money`/`len-*`/`regex` yes, the rest no).  True of a create body's
//     unboxed `int qty`; false of an operation body's, which RS-26 BOXES — so
//     `qty >= 1` on a null `Integer` threw `Integer.intValue()`.  That is what
//     W11/W12 had been absorbing on `POST /api/orders/{id}/add_line` since the
//     discovery run, under a reason that said the cause was "genuinely
//     unknown".  The slot's nullability now comes from the DTO's own boxing
//     decision (`wireComponentNullable`), so the two answers cannot diverge.
//   • the GENERIC-predicate arm had no guard at all, so `balance.amount >= 0`
//     rendered `balance.amount().compareTo(...)` and NPE'd on a `balance` the
//     record already marks `@NotNull` — and then again one step deeper, on a
//     `{"currency":""}` whose required `amount` was simply omitted.  Every
//     member step along a chain rooted at a nullable param is guarded now,
//     SHALLOW FIRST so `balance == null` short-circuits before `balance
//     .amount()` runs.
//
// An invariant that mentions `null` ITSELF is left alone: it is asking about
// absence, so skipping on absence would delete the check.
//
// ── F32: the workflow body had no wire boundary at all ────────────────────
// Create bodies got `@NotNull` with F23 and operation bodies with RS-26; the
// WORKFLOW request record got neither, and its controller never carried
// `@Valid`.  So a checkout missing `unitPrice` bound null and the generated
// `toMoney(MoneyRequest request)` dereferenced it.
//
// ── F33: every create route published 200 and answered 201 ────────────────
// springdoc infers the success status from the controller's return TYPE, which
// cannot see `ResponseEntity.created(...)`.  node, python and dotnet all
// publish `201`; java published `200` and answered a status it declared
// nowhere — the #2472 class, on every create route of every generated java API.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const src = `
system Bank {
  subdomain D {
    context Bank {
      enum WalletStatus { Open, Frozen }
      valueobject Money { amount: decimal  currency: string }
      aggregate Wallet with crudish {
        status: WalletStatus
        balance: Money
        units: int
        invariant balance.amount >= 0

        operation topUp(amount: Money) {
          precondition amount.amount > 0
          balance := Money { amount: balance.amount + amount.amount, currency: balance.currency }
        }

        operation addUnits(qty: int) {
          precondition qty > 0
          units := units + qty
        }
      }
      repository Wallets for Wallet { }

      workflow settle transactional {
        create(walletId: Wallet id, amount: Money, qty: int) {
          precondition qty > 0
          let wallet = Wallets.getById(walletId)
          wallet.topUp(amount)
        }
      }
    }
  }
  api A from D
  storage pg { type: postgres }
  resource bankState { for: Bank, kind: state, use: pg }
  deployable jv { platform: java, contexts: [Bank], dataSources: [bankState], serves: A, port: 4000 }
}
`;

async function file(suffix: string): Promise<string> {
  const files = await generateSystemFiles(src);
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return files.get(key as string) as string;
}

describe("java — F31: the invariant validator guards every value it dereferences", () => {
  it("a BOXED operation param is null-skipped (the W11/W12 root cause)", async () => {
    // RS-26 boxes `qty` into an `Integer`, so `qty >= 1` unboxed a null and
    // threw `Integer.intValue()`. The create body leaves the same field an
    // `int`, which is why asking the PATTERN was not enough.
    const validator = await file("wallets/AddUnitsWalletValidator.java");
    expect(validator).toContain("qty == null || qty >= 1");
  });

  it("the UNBOXED create-body twin stays unguarded — `int == null` would not compile", async () => {
    const create = await file("wallets/CreateWalletRequest.java");
    expect(create).toContain("int units");
    expect(create).not.toContain("@NotNull int units");
  });

  it("a generic predicate guards the nullable param it dereferences", async () => {
    const validator = await file("wallets/CreateWalletValidator.java");
    expect(validator).toContain(
      "balance == null || balance.amount() == null || balance.amount().compareTo(",
    );
  });

  it("the guards are ordered SHALLOW FIRST, so the chain short-circuits", async () => {
    const validator = await file("wallets/CreateWalletValidator.java");
    const outer = validator.indexOf("balance == null");
    const inner = validator.indexOf("balance.amount() == null");
    expect(outer).toBeGreaterThan(-1);
    expect(inner).toBeGreaterThan(outer);
  });

  it("an operation body's own precondition is guarded the same way", async () => {
    const validator = await file("wallets/TopUpWalletValidator.java");
    expect(validator).toContain(
      "amount == null || amount.amount() == null || amount.amount().compareTo(",
    );
  });

  it("the bound itself is unmoved — a PRESENT value still fails it", async () => {
    // Narrowness: skipping NULL must not skip a real violation. `-1` is
    // present and violates the invariant.
    const validator = await file("wallets/CreateWalletValidator.java");
    expect(validator).toContain('errors.rejectValue("balance", "loom.invariant"');
    expect(validator).toContain(") >= 0))");
  });
});

describe("java — F32: the workflow body is a wire boundary like every other", () => {
  it("required workflow params carry @NotNull, and a nested record @Valid", async () => {
    const req = await file("workflows/SettleRequest.java");
    expect(req).toContain("@NotNull @Valid MoneyRequest amount");
    expect(req).toContain("@NotNull UUID walletId");
  });

  // SUPERSEDED by F32's own follow-up slice (RS-26 on the workflow body).  The
  // original assertion here was "a PRIMITIVE workflow param gets no @NotNull —
  // it would be inert", which was true of the annotation and wrong about the
  // conclusion: the fix is not to drop the annotation but to BOX the component,
  // so the annotation has a null to test.  Left unboxed, a missing `qty` bound
  // to `0` and ran the workflow on a value the caller never sent, while the
  // same project's `RequiredSet` published `qty` as required.  Full coverage of
  // the rule (every param kind, the optional carve-out, the create body's
  // inverse) is `workflow-primitive-param-boxing.test.ts`; this keeps the F32
  // fixture honest about which side of it the workflow record is on.
  it("a PRIMITIVE workflow param is BOXED so its @NotNull can fire", async () => {
    const req = await file("workflows/SettleRequest.java");
    expect(req).toContain("@NotNull Integer qty");
    expect(req).not.toContain("@NotNull int qty");
    expect(req, "an unboxed component takes Jackson's zero value for an absent key").not.toMatch(
      /\bint qty\b/,
    );
  });

  it("the workflow controller runs the walk — without @Valid the annotations are inert", async () => {
    const ctrl = await file("api/BankWorkflowsController.java");
    expect(ctrl).toContain("@Valid @RequestBody SettleRequest request");
    expect(ctrl).toContain("import jakarta.validation.Valid;");
  });
});

describe("java — F33: a create route publishes the 201 it answers", () => {
  it("the create route carries successStatus 201; nothing else does", async () => {
    const c = await file("config/OpenApiContractCustomizer.java");
    expect(c).toContain(
      'new Route("post", "/api/wallets", null, new int[] {400, 415, 422}, null, 201)',
    );
    expect(c).toContain(
      'new Route("get", "/api/wallets/{id}", null, new int[] {404, 422}, null, 0)',
    );
  });

  it("the customizer re-keys the inferred 2xx rather than annotating a lie", async () => {
    const c = await file("config/OpenApiContractCustomizer.java");
    expect(c).toContain("retargetSuccess(op, route.successStatus());");
    expect(c).toContain("ApiResponse resp = responses.remove(found);");
    expect(c).toContain('case 201 -> "Created";');
    // `@ResponseStatus` is IGNORED at runtime on a ResponseEntity-returning
    // method, so the controller must NOT claim one on the create.
    const ctrl = await file("wallets/WalletsController.java");
    expect(ctrl).toContain("ResponseEntity.created(");
    const create = ctrl.indexOf("createWallet(");
    const annotated = ctrl.indexOf("@ResponseStatus(HttpStatus.CREATED)");
    expect(create).toBeGreaterThan(-1);
    expect(annotated).toBe(-1);
  });
});

// Java/Spring read-mask redaction (`mask unless`, authorization.md §5, M-T3.2
// item 6). A masked aggregate's response record gains a `fromMasked` mapper that
// redacts each masked field to null unless the ambient principal satisfies the
// predicate (fail-closed); `from` stays unmasked for audit snapshots. Read
// services + explicit handlers project through `fromMasked`. Compile-verified
// separately (gradle, JDK 25); this pins the emit shape.

import { NodeFileSystem } from "langium/node";
import { parseHelper } from "langium/test";
import { describe, expect, it } from "vitest";
import { generateJavaForContexts } from "../../../src/generator/java/index.js";
import { enrichLoomModel } from "../../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../../src/ir/lower/lower.js";
import { createDddServices } from "../../../src/language/ddd-module.js";
import type { Model } from "../../../src/language/generated/ast.js";

/** Every JDK symbol a `mask unless` predicate's Java rendering can name as a
 *  BARE simple name, and the import each one needs.  `renderJavaExpr` writes
 *  these; `collectJavaExprImports` is what knows they need importing, and the
 *  defect was an emitter that called the first without the second. */
const JDK_SYMBOL_IMPORTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bObjects\./, "java.util.Objects"],
  [/\bPattern\./, "java.util.regex.Pattern"],
  [/\bBigDecimal\b/, "java.math.BigDecimal"],
  [/\bMathContext\b/, "java.math.MathContext"],
  [/\bInstant\./, "java.time.Instant"],
  [/\bDuration\./, "java.time.Duration"],
];

/** Assert the file imports every JDK symbol it names.  Deliberately scans the
 *  WHOLE file rather than just the mapper: a symbol is either in scope or it is
 *  not, and `javac` does not care which method introduced it. */
function expectJdkSymbolsImported(content: string, what: string): void {
  for (const [used, imp] of JDK_SYMBOL_IMPORTS) {
    if (!used.test(content)) continue;
    expect(content, `${what} names ${used.source} but never imports ${imp}`).toContain(
      `import ${imp};`,
    );
  }
}

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
}`;

async function files(): Promise<Map<string, string>> {
  const services = createDddServices(NodeFileSystem);
  const helper = parseHelper<Model>(services.Ddd);
  const doc = await helper(SRC, { validation: true });
  const loom = enrichLoomModel(lowerModel(doc.parseResult.value));
  const contexts = loom.systems.flatMap((s) => s.subdomains.flatMap((sd) => sd.contexts));
  return generateJavaForContexts(contexts, "S");
}

describe("mask unless — Java read redaction", () => {
  it("keeps `from` unmasked and adds a fail-closed `fromMasked` on the response record", async () => {
    const out = await files();
    const resp = [...out.entries()].find(([k]) => k.endsWith("PResponse.java"))?.[1] ?? "";
    // The masked component admits null (boxed / reference type).  BOXED
    // `Double`, not `BigDecimal`: a response `decimal` narrows to the wire's
    // `double` (RS-24 / #2563; #2575 on .NET, M-T6.46 here), and `mask unless`
    // forces the boxed form so the redacted arm can pass null.
    expect(resp).toMatch(/Double salary/);
    expect(resp).not.toContain("BigDecimal");
    // `from` stays unmasked (audit before/after snapshots project through it).
    expect(resp).toMatch(
      /public static PResponse from\(P value\) \{\s*\n\s*return new PResponse\(/,
    );
    // `fromMasked` binds the ambient principal statically and redacts fail-closed.
    expect(resp).toContain("public static PResponse fromMasked(P value)");
    expect(resp).toContain("User __maskUser = CurrentUserAccessor.currentOrNull();");
    expect(resp).toContain("__maskUser != null &&");
    expect(resp).toContain('__maskUser.permissions().contains("m.unmask")');
    // The projected arm narrows before the mask guard chooses it.
    expect(resp).toContain(
      "? value.salary() == null ? null : (value.salary()).doubleValue() : null",
    );
    // imports where the static accessor + principal type live.
    expect(resp).toMatch(/import \S+\.auth\.CurrentUserAccessor;/);
    expect(resp).toMatch(/import \S+\.auth\.User;/);
  });

  it("routes read services through fromMasked", async () => {
    const out = await files();
    const svc = [...out.entries()].find(([k]) => k.endsWith("PService.java"))?.[1] ?? "";
    // Every read (get-by-id, all, finds) redacts via the masked mapper.
    expect(svc).toContain("PResponse::fromMasked");
    // No read routes through the bare (unmasked) `from` mapper.
    expect(svc).not.toMatch(/\.map\(PResponse::from\)/);
  });
});

// ── The `mask unless` mapper's own imports ──────────────────────────────────
//
// `mask unless` is the FIELD-LEVEL READ-REDACTION SECURITY CONTROL, and on Java
// it had evidently never been compiled: the simplest possible predicate,
// `currentUser.role == "admin"`, renders through the Java expression target's
// equality lowering as `Objects.equals(__maskUser.role(), "admin")` — and
// `PersonResponse.java`'s import block carried `CurrentUserAccessor`, `User`,
// `UUID` and three domain wildcards, but no `java.util.Objects`:
//
//   PersonResponse.java:21: error: cannot find symbol
//     symbol:   variable Objects
//     location: class PersonResponse
//
// The emitter added the two imports the mapper's own SCAFFOLDING needs
// (`CurrentUserAccessor` / `User`) and none of the ones the rendered PREDICATE
// needs.  `collectJavaExprImports` already existed and is already called for
// the `requires` / `when` gates in `service.ts` — the DTO emitter (and the
// history mapper `service.ts` inlines) simply never called it.
//
// Pinned as "every JDK symbol the file names is imported" rather than
// "`Objects` is imported", because the predicate is an arbitrary expression:
// `matches` renders `Pattern.compile(...)`, a decimal literal a `BigDecimal`,
// `now()` an `Instant`.
const MASK_EXPR_SRC = `system S {
  user { sub: string  role: string  level: int  email: string }
  subdomain M {
    context C {
      aggregate Person audited with crudish {
        name: string
        ssn: string mask unless currentUser.role == "admin"
        salary: decimal mask unless currentUser.level >= 3
        notes: string mask unless currentUser.email.matches("^.*@corp[.]com$")
      }
      repository Persons for Person { }
    }
  }
}`;

async function maskExprFiles(): Promise<Map<string, string>> {
  const services = createDddServices(NodeFileSystem);
  const helper = parseHelper<Model>(services.Ddd);
  const doc = await helper(MASK_EXPR_SRC, { validation: true });
  const loom = enrichLoomModel(lowerModel(doc.parseResult.value));
  const contexts = loom.systems.flatMap((s) => s.subdomains.flatMap((sd) => sd.contexts));
  return generateJavaForContexts(contexts, "S");
}

describe("mask unless — the rendered predicate's imports", () => {
  it("the response record imports every JDK symbol its `fromMasked` names", async () => {
    const out = await maskExprFiles();
    const resp = [...out.entries()].find(([k]) => k.endsWith("PersonResponse.java"))?.[1] ?? "";
    expect(resp).toContain("public static PersonResponse fromMasked(Person value)");
    // The three renderings under test actually appear …
    expect(resp).toContain('Objects.equals(__maskUser.role(), "admin")');
    expect(resp).toContain("Pattern.compile(");
    // … and each one is in scope.
    expectJdkSymbolsImported(resp, "PersonResponse.java");
  });

  it("the service imports every JDK symbol the inlined history mapper names", async () => {
    // `renderJavaHistoryMapper` renders the SAME predicates into the service
    // (the mapper is a private static there), so the service needs them too —
    // and it only ever added `User` / `CurrentUserAccessor`.
    const out = await maskExprFiles();
    const svc = [...out.entries()].find(([k]) => k.endsWith("PersonService.java"))?.[1] ?? "";
    expect(svc).toContain("User __maskUser = CurrentUserAccessor.currentOrNull();");
    expect(svc).toContain('Objects.equals(__maskUser.role(), "admin")');
    expect(svc).toContain("Pattern.compile(");
    expectJdkSymbolsImported(svc, "PersonService.java");
  });

  it("a mask-free aggregate's response record gains no extra import", async () => {
    const out = await maskExprFiles();
    // Control: the emitted import set is driven by what the file NAMES, not by
    // "this project has a mask somewhere".
    const req = [...out.entries()].find(([k]) => k.endsWith("CreatePersonRequest.java"))?.[1] ?? "";
    expect(req).not.toContain("import java.util.Objects;");
    expect(req).not.toContain("import java.util.regex.Pattern;");
  });
});

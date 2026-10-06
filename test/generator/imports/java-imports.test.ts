import { describe, expect, it } from "vitest";
import { finalizeJavaUnit, JAVA_IMPORTS, javaRef } from "../../../src/generator/_imports/java.js";
import { hasMarkers } from "../../../src/generator/_imports/symbol.js";
import { generateCorpusCase } from "../../fixtures/corpus/harness.js";

// M-T9.86 — imports derived from use, Java finalizer (google-java-format
// order: statics, blank line, then every other import in ASCII order).

const unit = (...lines: string[]): string => lines.join("\n");

describe("finalizeJavaUnit — derivation", () => {
  it("derives the block from the markers that survived", () => {
    const out = finalizeJavaUnit(
      unit(
        "package com.loom.d.x;",
        "",
        JAVA_IMPORTS,
        "",
        `public class A { ${javaRef("java.util", "List")}<${javaRef("java.math", "BigDecimal")}> xs; }`,
        "",
      ),
    );
    expect(out).toBe(
      unit(
        "package com.loom.d.x;",
        "",
        "import java.math.BigDecimal;",
        "import java.util.List;",
        "",
        "public class A { List<BigDecimal> xs; }",
        "",
      ),
    );
  });

  it("own-package, java.lang and on-demand-covered types need no line", () => {
    const out = finalizeJavaUnit(
      unit(
        "package com.loom.d.x;",
        "",
        "import com.loom.d.domain.ids.*;",
        "",
        `class A { ${javaRef("com.loom.d.x", "B")} b; ${javaRef("java.lang", "String")} s; ${javaRef("com.loom.d.domain.ids", "OrderId")} id; }`,
      ),
    );
    expect(out).toBe(
      unit(
        "package com.loom.d.x;",
        "",
        "import com.loom.d.domain.ids.*;",
        "",
        "class A { B b; String s; OrderId id; }",
      ),
    );
  });

  it("canonical order: statics first, then ASCII, duplicates collapse", () => {
    const out = finalizeJavaUnit(
      unit(
        "package p;",
        "",
        "import org.b.B;",
        "import java.util.List;",
        "",
        "import static org.junit.jupiter.api.Assertions.*;",
        "import jakarta.persistence.*;",
        "import java.util.List;",
        "",
        "class A {}",
      ),
    );
    expect(out).toBe(
      unit(
        "package p;",
        "",
        "import static org.junit.jupiter.api.Assertions.*;",
        "",
        "import jakarta.persistence.*;",
        "import java.util.List;",
        "import org.b.B;",
        "",
        "class A {}",
      ),
    );
  });

  it("fails closed on two types sharing a simple name (Java has no import alias)", () => {
    expect(() =>
      finalizeJavaUnit(
        unit("package p;", "", JAVA_IMPORTS, "", `${javaRef("a.x", "Id")} ${javaRef("b.y", "Id")}`),
      ),
    ).toThrow(/two imports bind 'Id'/);
  });

  it("fails closed when a referencing unit has no import region", () => {
    expect(() =>
      finalizeJavaUnit(unit("package p;", "class A { " + javaRef("java.util", "List") + " x; }"), {
        path: "A.java",
      }),
    ).toThrow(/A\.java: references List but has no import region/);
  });
});

describe("the java backend finalizes every unit it emits", () => {
  it.each([
    "core-domain",
    "auth-oidc",
    "channels-broker",
    "saga",
    "projection-join",
  ])("%s: every .java is canonical and marker-free", async (feature) => {
    const files = await generateCorpusCase(feature, "java");
    const units = [...files].filter(([p]) => p.endsWith(".java"));
    expect(units.length).toBeGreaterThan(10);
    const off = units
      .filter(([path, c]) => hasMarkers(c) || finalizeJavaUnit(c, { path }) !== c)
      .map(([p]) => p);
    expect(off).toEqual([]);
  });
});

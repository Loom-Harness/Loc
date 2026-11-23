import { describe, expect, it } from "vitest";
import {
  finalizeJavaUnit,
  indexJavaProject,
  JAVA_IMPORTS,
  javaProjectRef,
  javaRef,
  javaSimpleNames,
} from "../../../src/generator/_imports/java.js";
import { hasMarkers } from "../../../src/generator/_imports/symbol.js";
import { generateCorpusCase } from "../../fixtures/corpus/harness.js";

// Imports derived from use, Java finalizer (google-java-format order: statics,
// blank line, then every other import in ASCII order).  Import hygiene: these
// pin what the finalizer writes into the import block, which no compile tier
// observes beyond "it compiles".

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

  it("own-package and java.lang types need no line", () => {
    const out = finalizeJavaUnit(
      unit(
        "package com.loom.d.x;",
        "",
        JAVA_IMPORTS,
        "",
        `class A { ${javaRef("com.loom.d.x", "B")} b; ${javaRef("java.lang", "String")} s; }`,
      ),
    );
    expect(out).toBe(unit("package com.loom.d.x;", "", "class A { B b; String s; }"));
  });

  it("canonical order: statics first, then ASCII, duplicates collapse", () => {
    const out = finalizeJavaUnit(
      unit(
        "package p;",
        "",
        "import org.b.B;",
        "import java.util.List;",
        "",
        "import static org.junit.jupiter.api.Assertions.assertTrue;",
        "import jakarta.persistence.Entity;",
        "import java.util.List;",
        "",
        "class A {}",
      ),
    );
    expect(out).toBe(
      unit(
        "package p;",
        "",
        "import static org.junit.jupiter.api.Assertions.assertTrue;",
        "",
        "import jakarta.persistence.Entity;",
        "import java.util.List;",
        "import org.b.B;",
        "",
        "class A {}",
      ),
    );
  });

  it("fails closed on two framework types sharing a simple name (Java has no import alias)", () => {
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

describe("javaSimpleNames — the names a unit's code spells unqualified", () => {
  it("skips qualified segments, comments, strings, text blocks and char literals", () => {
    const names = javaSimpleNames(
      [
        '@Column(name = "Table") // Index',
        "/* Embedded */ private Money total = com.x.Other.of('A');",
        'String s = """',
        "  Version",
        '  """;',
      ].join("\n"),
    );
    expect([...names].sort()).toEqual([
      "Column",
      "Money",
      "String",
      "com",
      "name",
      "private",
      "s",
      "total",
    ]);
  });
});

describe("finalizeJavaUnit — on-demand imports become single-type imports", () => {
  const index = indexJavaProject([
    ["a/Money.java", "package com.loom.d.domain.valueobjects;\n\npublic record Money() {}\n"],
    ["a/Tax.java", "package com.loom.d.domain.valueobjects;\n\npublic record Tax() {}\n"],
    ["a/Record.java", "package com.loom.d.domain.valueobjects;\n\npublic record Record() {}\n"],
    ["a/Page.java", "package com.loom.d.domain.valueobjects;\n\npublic record Page() {}\n"],
    ["a/Status.java", "package com.loom.d.domain.enums;\n\npublic enum Status { A }\n"],
    ["a/Kind.java", "package com.loom.d.domain.enums;\n\npublic enum Kind { A }\n"],
    ["b/Kind.java", "package com.loom.d.domain.other;\n\npublic enum Kind { A }\n"],
    ["a/Line.java", "package com.loom.d.x;\n\npublic class Line {}\n"],
  ]);
  const at = (path: string, ...lines: string[]): string =>
    finalizeJavaUnit(unit(...lines), { path, index });

  it("a framework package: only the types the code names", () => {
    const out = at(
      "A.java",
      "package com.loom.d.x;",
      "",
      "import jakarta.persistence.*;",
      "",
      '@Entity @Table(name = "a") class A { @Column String c; }',
    );
    expect(out).toContain("import jakarta.persistence.Column;");
    expect(out).toContain("import jakarta.persistence.Entity;");
    expect(out).toContain("import jakarta.persistence.Table;");
    expect(out).not.toContain("*");
  });

  it("a static on-demand import: only the members the code calls", () => {
    const out = at(
      "T.java",
      "package com.loom.d.x;",
      "",
      "import static org.junit.jupiter.api.Assertions.*;",
      "",
      "class T { void t() { assertEquals(1, 1); assertTrue(true); } }",
    );
    expect(out).toContain(
      unit(
        "import static org.junit.jupiter.api.Assertions.assertEquals;",
        "import static org.junit.jupiter.api.Assertions.assertTrue;",
      ),
    );
    expect(out).not.toContain("*");
  });

  it("a project package: the types the code names, from the project's index", () => {
    const out = at(
      "A.java",
      "package com.loom.d.x;",
      "",
      "import com.loom.d.domain.valueobjects.*;",
      "import com.loom.d.domain.enums.*;",
      "",
      "class A { Money m; Status s; }",
    );
    expect(out).toContain("import com.loom.d.domain.enums.Status;");
    expect(out).toContain("import com.loom.d.domain.valueobjects.Money;");
    expect(out).not.toContain("Tax");
    expect(out).not.toContain("*");
  });

  it("a name java.lang, the unit's own package or another import already binds is not imported", () => {
    const out = at(
      "A.java",
      "package com.loom.d.x;",
      "",
      "import com.loom.d.domain.valueobjects.*;",
      "import org.springframework.data.domain.Page;",
      "",
      "class A { Record r; Page<Line> p; Money m; }",
    );
    expect(out).not.toContain("valueobjects.Record;");
    expect(out).not.toContain("valueobjects.Page;");
    expect(out).toContain("import com.loom.d.domain.valueobjects.Money;");
  });

  it("a name two imported project packages declare stays unimported (it was ambiguous)", () => {
    const out = at(
      "A.java",
      "package com.loom.d.x;",
      "",
      "import com.loom.d.domain.enums.*;",
      "import com.loom.d.domain.other.*;",
      "",
      "class A { Kind k; }",
    );
    expect(out).not.toContain("Kind;");
  });

  it("refuses an on-demand import of a package it cannot enumerate", () => {
    expect(() =>
      at("A.java", "package com.loom.d.x;", "", "import java.util.*;", "", "class A { List l; }"),
    ).toThrow(/A\.java: imports 'java\.util\.\*' on demand/);
    expect(() =>
      at("A.java", "package com.loom.d.x;", "", "import static org.x.Y.*;", "", "class A {}"),
    ).toThrow(/A\.java: imports 'org\.x\.Y\.\*' on demand/);
  });
});

describe("finalizeJavaUnit — project references (the symbol plan's Java ambient clash)", () => {
  const index = indexJavaProject([
    ["a/Money.java", "package com.loom.d.domain.valueobjects;\n\npublic record Money() {}\n"],
    ["a/String.java", "package com.loom.d.domain.valueobjects;\n\npublic record String() {}\n"],
    ["a/Instant.java", "package com.loom.d.domain.valueobjects;\n\npublic record Instant() {}\n"],
  ]);
  const at = (...lines: string[]): string => finalizeJavaUnit(unit(...lines), { index });
  const head = ["package com.loom.d.x;", "", JAVA_IMPORTS, ""];

  it("a free name is spelled bare and imported", () => {
    const out = at(...head, `class A { ${javaProjectRef("Money")} m; }`);
    expect(out).toBe(
      unit(
        "package com.loom.d.x;",
        "",
        "import com.loom.d.domain.valueobjects.Money;",
        "",
        "class A { Money m; }",
      ),
    );
  });

  it("a java.lang name is spelled fully qualified, so the bare name stays java.lang's", () => {
    const out = at(...head, `class A { ${javaProjectRef("String")} v; String s; }`);
    expect(out).toBe(
      unit(
        "package com.loom.d.x;",
        "",
        "class A { com.loom.d.domain.valueobjects.String v; String s; }",
      ),
    );
  });

  it("a name a framework import binds in the unit is spelled fully qualified", () => {
    const out = at(
      ...head,
      `class A { ${javaProjectRef("Instant")} v; ${javaRef("java.time", "Instant")} at; }`,
    );
    expect(out).toContain("import java.time.Instant;");
    expect(out).toContain("class A { com.loom.d.domain.valueobjects.Instant v; Instant at; }");
    expect(out).not.toContain("import com.loom.d.domain.valueobjects.Instant;");
  });

  it("the same name in a unit that does not import the framework type is bare", () => {
    const out = at(...head, `class A { ${javaProjectRef("Instant")} v; }`);
    expect(out).toContain("import com.loom.d.domain.valueobjects.Instant;");
    expect(out).toContain("class A { Instant v; }");
  });

  it("inside its own package a project reference needs no line", () => {
    const out = finalizeJavaUnit(
      unit(
        "package com.loom.d.domain.valueobjects;",
        "",
        `record B(${javaProjectRef("Money")} m) {}`,
      ),
      { index },
    );
    expect(out).toBe(unit("package com.loom.d.domain.valueobjects;", "", "record B(Money m) {}"));
  });

  it("a framework reference yields its simple name to a type the unit declares", () => {
    const out = finalizeJavaUnit(
      unit(
        "package com.loom.d.features.columns;",
        "",
        JAVA_IMPORTS,
        "",
        `@${javaRef("jakarta.persistence", "Entity")} public class Column { @${javaRef("jakarta.persistence", "Column")} String c; }`,
      ),
      { index },
    );
    expect(out).toBe(
      unit(
        "package com.loom.d.features.columns;",
        "",
        "import jakarta.persistence.Entity;",
        "",
        "@Entity public class Column { @jakarta.persistence.Column String c; }",
      ),
    );
  });
});

describe("finalizeJavaUnit — a platform name a type of the unit's own takes", () => {
  const index = indexJavaProject([
    ["a/String.java", "package com.loom.d.domain.valueobjects;\n\npublic record String() {}\n"],
    ["a/Money.java", "package com.loom.d.domain.valueobjects;\n\npublic record Money() {}\n"],
    ["b/Holder.java", "package com.loom.d.features.holders;\n\npublic class Holder {}\n"],
    ["c/List.java", "package com.loom.d.features.lists;\n\npublic class List {}\n"],
    ["c/ListRepo.java", "package com.loom.d.features.lists;\n\npublic interface ListRepo {}\n"],
    ["c/Table.java", "package com.loom.d.features.lists;\n\npublic class Table {}\n"],
    ["d/Paged.java", "package com.loom.d.domain.common;\n\npublic record Paged<T>() {}\n"],
    ["e/Paged.java", "package com.loom.d.features.pageds;\n\npublic class Paged {}\n"],
    [
      "f/DomainException.java",
      "package com.loom.d.domain.common;\n\npublic class DomainException {}\n",
    ],
    [
      "g/DomainException.java",
      "package com.loom.d.domain.valueobjects;\n\npublic record DomainException() {}\n",
    ],
    ["h/Instant.java", "package com.loom.d.domain.events;\n\npublic record Instant() {}\n"],
  ]);
  const fin = (...lines: string[]): string => finalizeJavaUnit(unit(...lines), { index });

  it("a shadowed java.lang name the emitters spell bare is java.lang's, spelled java.lang.X", () => {
    const out = fin(
      "package com.loom.d.domain.valueobjects;",
      "",
      JAVA_IMPORTS,
      "",
      "public record String(String v) {",
      "    public String {",
      "    }",
      "    public String(int n) { this(String.valueOf(n)); }",
      "    @Override public String toString() { return v; }",
      "}",
    );
    expect(out).toBe(
      unit(
        "package com.loom.d.domain.valueobjects;",
        "",
        "public record String(java.lang.String v) {",
        "    public String {",
        "    }",
        "    public String(int n) { this(java.lang.String.valueOf(n)); }",
        "    @Override public java.lang.String toString() { return v; }",
        "}",
      ),
    );
  });

  it("an unshadowed unit keeps every bare java.lang name", () => {
    const text = unit(
      "package com.loom.d.features.holders;",
      "",
      "public class Holder { String label; Object o; }",
    );
    expect(finalizeJavaUnit(text, { index })).toBe(text);
  });

  it("a project reference to the shadowing type is spelled fully qualified, the bare name java.lang's", () => {
    const out = fin(
      "package com.loom.d.features.holders;",
      "",
      JAVA_IMPORTS,
      "",
      `class A { ${javaProjectRef("String", "valueobject")} v; String s; }`,
    );
    expect(out).toContain("class A { com.loom.d.domain.valueobjects.String v; String s; }");
  });

  it("a type annotation follows the qualifier", () => {
    const out = fin(
      "package com.loom.d.domain.valueobjects;",
      "",
      JAVA_IMPORTS,
      "",
      "record Money(@NotNull @NoNulChar String a, List<@NoNulChar String> b) {}",
    );
    expect(out).toContain(
      "record Money(@NotNull java.lang.@NoNulChar String a, List<java.lang.@NoNulChar String> b) {}",
    );
  });

  it("a framework import a type of the unit's package shadows is qualified, not imported, when the unit declares it", () => {
    const out = fin(
      "package com.loom.d.features.lists;",
      "",
      "import java.util.List;",
      "",
      "public class List { List<String> xs; }",
    );
    expect(out).toBe(
      unit(
        "package com.loom.d.features.lists;",
        "",
        "public class List { java.util.List<String> xs; }",
      ),
    );
  });

  it("a framework on-demand member a type of the unit's package takes is qualified", () => {
    const out = fin(
      "package com.loom.d.features.lists;",
      "",
      "import jakarta.persistence.*;",
      "",
      "@Entity interface ListRepo { @Table Object t; }",
    );
    expect(out).toContain("import jakarta.persistence.Entity;");
    expect(out).toContain("@Entity interface ListRepo { @jakarta.persistence.Table Object t; }");
  });

  it("two project types of one simple name: the explicit-package and the domain reference both resolve", () => {
    const out = fin(
      "package com.loom.d.features.pageds;",
      "",
      JAVA_IMPORTS,
      "",
      `interface R { ${javaRef("com.loom.d.domain.common", "Paged")}<${javaProjectRef("Paged")}> all(); }`,
    );
    expect(out).toContain("interface R { com.loom.d.domain.common.Paged<Paged> all(); }");
  });

  // Wiring no booted tier names: no corpus fixture declares an event named
  // like a platform type the aggregate unit also imports.
  it("an event reference is the project's: the platform type of its name keeps its import", () => {
    const out = fin(
      "package com.loom.d.features.holders;",
      "",
      JAVA_IMPORTS,
      "",
      `class A { ${javaRef("java.time", "Instant")} at; Object e = new ${javaProjectRef("Instant", "event")}(); }`,
    );
    expect(out).toContain("import java.time.Instant;");
    expect(out).toContain("Object e = new com.loom.d.domain.events.Instant();");
  });

  it("a value-object reference whose name a generated runtime type shares resolves to the value object", () => {
    const out = fin(
      "package com.loom.d.features.holders;",
      "",
      "import com.loom.d.domain.common.DomainException;",
      "",
      `class A { ${javaProjectRef("DomainException", "valueobject")} v; DomainException e; }`,
    );
    expect(out).toContain("import com.loom.d.domain.common.DomainException;");
    expect(out).toContain(
      "class A { com.loom.d.domain.valueobjects.DomainException v; DomainException e; }",
    );
  });
});

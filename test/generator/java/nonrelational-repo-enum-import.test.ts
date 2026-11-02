// ---------------------------------------------------------------------------
// A repository read with an ENUM param on a non-relational java aggregate must
// emit a repository impl that compiles.
//
//     criterion ByGrade(grade: Grade) of Widget = …   // on `shape: document`
//
//   → public List<Widget> runFindAllByByGrade(Grade grade) {  // WidgetRepositoryImpl.java
//     javac without the import: cannot find symbol / symbol: class Grade
//
// `renderJavaType` spells an enum param as the bare enum name, and the RELATIONAL
// impl imports `<base>.domain.enums.*` for exactly that reason
// (`emit/repository.ts:305`).  The document and event-store impls assembled their
// own import list, and each must carry it too — or a model that compiles on the
// default saving shape stops compiling when the aggregate is `shape: document`
// or `persistedAs: eventLog`, with zero diagnostics.  Paged or not, the read
// names the enum the same way.
//
// This is a static test because the compile tier cannot reach the shape: no
// corpus fixture pairs a non-relational saving shape with an enum-typed read
// param.  The import is the fix; asserting it is the pin.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

/** A single-row criterion read over the enum param, or (`paged`) the same
 *  criterion run by a paged queryHandler — read through the synthesised
 *  `findAllBy<Criterion>`. */
const READS = {
  single: `repository Widgets for Widget { }
      criterion ByGrade(grade: Grade) of Widget = this.grade == grade
      queryHandler FirstByGrade(grade: Grade): Widget? {
        let w = Widgets.find(ByGrade(grade))
        return w
      }`,
  paged: `repository Widgets for Widget { }
      criterion ByGrade(grade: Grade) of Widget = this.grade == grade
      queryHandler ListByGrade(grade: Grade): Widget paged {
        let r = Widgets.all(ByGrade(grade))
        return r
      }`,
} as const;

const src = (shape: string, read: keyof typeof READS): string => `
system PG {
  subdomain S {
    context C {
      enum Grade { A, B }
      aggregate Widget ${shape}with crudish {
        grade: Grade
      }
      ${READS[read]}
    }
  }
  api A from S
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable dj { platform: java, contexts: [C], dataSources: [st], serves: A, port: 4000 }
}`;

async function repoImpl(source: string): Promise<string> {
  const files = await generateSystemFiles(source);
  const hit = [...files.entries()].find(([p]) => p.endsWith("WidgetRepositoryImpl.java"));
  if (!hit)
    throw new Error(`no WidgetRepositoryImpl; got:\n${[...files.keys()].sort().join("\n")}`);
  return hit[1];
}

describe("non-relational java repository impls import the enums they name", () => {
  // Each case asserts the SIGNATURE that names the type as well as the import —
  // an import assertion alone would still pass if the param stopped being
  // emitted at all, which is the "the check never reached the thing it names"
  // failure shape.
  const cases: [string, string, keyof typeof READS][] = [
    ["document", "shape: document, ", "single"],
    ["document (paged)", "shape: document, ", "paged"],
    ["relational (the sibling that was already right)", "", "single"],
  ];

  for (const [name, shape, ret] of cases) {
    it(`${name}: names Grade in the signature and imports it`, async () => {
      const impl = await repoImpl(src(shape, ret));
      expect(impl, "the read must still take the enum param").toContain("Grade grade");
      expect(impl, "…and nothing else in the file declares Grade").toContain(
        "import com.loom.dj.domain.enums.*;",
      );
    });
  }

  // The event-store impl assembles its own import list too, and had the same
  // omission.  It needs a real decide-and-emit aggregate (an event-sourced body
  // may not assign `this`), so it gets its own fixture rather than a `shape:`
  // swap on the one above.
  it("event-sourced: the same import, on the event-store impl", async () => {
    const impl = await repoImpl(`
system PG {
  subdomain S {
    context C {
      enum Grade { A, B }
      event Graded { widget: Widget id, grade: Grade }
      aggregate Widget persistedAs: eventLog {
        grade: Grade
        create make(grade: Grade) { emit Graded { widget: id, grade: grade } }
        apply(e: Graded) { grade := e.grade }
      }
      repository Widgets for Widget { }
      criterion WidgetsByGrade(grade: Grade) of Widget = this.grade == grade
      queryHandler FirstByGrade(grade: Grade): Widget? {
        let w = Widgets.find(WidgetsByGrade(grade))
        return w
      }
    }
  }
  api A from S
  storage pg { type: postgres }
  resource st { for: C, kind: eventLog, use: pg }
  deployable dj { platform: java, contexts: [C], dataSources: [st], serves: A, port: 4000 }
}`);
    expect(impl).toContain("runFindAllByWidgetsByGrade(Grade grade)");
    expect(impl).toContain("import com.loom.dj.domain.enums.*;");
  });
});

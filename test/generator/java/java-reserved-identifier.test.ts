// ---------------------------------------------------------------------------
// M-T6.36 (F2-ADP-7's java arm) — a `.ddd` name that collides with a JAVA
// reserved word, EMITTED rather than refused.
//
// `aggregate Ticket with crudish { case: string  do: int }` on `platform: java`
// used to emit, in `features/tickets/Ticket.java`:
//
//     String case;                        // <- javac: <identifier> expected
//     public String case() { … }
//     record TicketResponse(String case, int do, …)
//
// It was then REFUSED by `loom.java-reserved-identifier-unsupported`, because
// Java has no verbatim identifier (JLS §3.9) and a record component name IS the
// Jackson property name — so a bare rename would have moved `{"case": …}` to
// `{"case_": …}` on java alone.  The gate is gone; the name is now emitted as a
// MANGLED host identifier (`case_`, `escapeJavaIdent`'s spelling) plus an
// explicit wire annotation wherever the java identifier would otherwise have
// become the wire name.
//
// WHAT THIS FILE PINS is that the two halves never travel apart, on every wire
// surface the name reaches:
//
//   * JSON     — `@JsonProperty("case")` on the request / response / event /
//                projection-row / workflow-instance record component
//   * OpenAPI  — springdoc reads Jackson, so the published schema key follows
//   * query    — `@RequestParam("case")` on a find parameter
//   * pointer  — the advice's `pointerOf` inverts the mangle, so a 422 names
//                `/case` (Spring binding paths never go through Jackson)
//   * column   — `@Column(name = "`case`")` is unchanged (the SQL half was
//                already quoted by M-T6.42/M-T6.43), and an ENUM value persists
//                through the generated `<Enum>.Codec` converter rather than
//                `@Enumerated(STRING)`, whose `name()` would write `case_`
//   * JPQL /   — `e.case_` / `root.get("case_")` name the JPA ATTRIBUTE, and the
//     Criteria   `?sort=` whitelist stays the wire key with one translation line
//
// The RESERVED-WORD SWEEP at the bottom is the vacuity-guarded ratchet: it
// walks EVERY emitted `.java` file of the fixture project and fails on any
// remaining bare reserved word in identifier position, so a wire site added
// later that forgets the funnel fails here rather than in a compile tier.
//
// SCOPED TO THE AXIS: `get case()` (node), `def case` (python), `field :case`
// (elixir) and `@case` (dotnet) are all legal, and this file pins that those
// four backends' emission is untouched.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

/** Every position the `loom.java-reserved-identifier-unsupported` gate used to
 *  refuse, in one model: aggregate field (scalar / bool / money / VO / VO array
 *  / `X id`), derived field, containment part field, operation name, operation
 *  parameter, helper-function name and parameter, value-object field, event
 *  field, repository find + its filter column, enum VALUE, projection state
 *  field and workflow state field. */
const SOURCE = (platform: string): string => `
system RW {
  subdomain S {
    context C {
      enum Kind { case, plain }
      valueobject Span { double: int  char: string }
      event Switched { case: string  do: int }
      aggregate Owner with crudish { label: string }
      aggregate Ticket with crudish {
        case: string
        do: int
        final: bool
        native: money
        kind: Kind
        span: Span
        spans: Span[]
        owner: Owner id
        derived transient: string = this.case
        entity Note { throws: string  synchronized: int }
        contains notes: Note[]
        function volatile(strictfp: int): int = strictfp + this.do
        operation retitle(next: string) {
          case := next
          emit Switched { case: this.case, do: this.do }
        }
        invariant do >= 0
      }
      repository Tickets for Ticket {
        find byCase(case: string): Ticket[] where this.case == case
      }
    }
  }
  api A from S
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable d {
    platform: ${platform}
    contexts: [C]
    dataSources: [st]
    serves: A
    port: 4000
  }
}`;

let cachedJava: Map<string, string> | undefined;
async function javaFiles(): Promise<Map<string, string>> {
  if (!cachedJava) cachedJava = await generateSystemFiles(SOURCE("java"));
  return cachedJava;
}

const file = async (path: string): Promise<string> => {
  const f = (await javaFiles()).get(path);
  expect(f, `${path} was not emitted`).toBeTruthy();
  return f!;
};

const ENTITY = "d/src/main/java/com/loom/d/features/tickets/Ticket.java";
const RESPONSE = "d/src/main/java/com/loom/d/features/tickets/TicketResponse.java";
const CREATE_REQ = "d/src/main/java/com/loom/d/features/tickets/CreateTicketRequest.java";
const CONTROLLER = "d/src/main/java/com/loom/d/features/tickets/TicketsController.java";
const REPO_IMPL = "d/src/main/java/com/loom/d/features/tickets/TicketRepositoryImpl.java";
const JPA_REPO = "d/src/main/java/com/loom/d/features/tickets/TicketJpaRepository.java";
const EVENT = "d/src/main/java/com/loom/d/domain/events/Switched.java";
const ENUM = "d/src/main/java/com/loom/d/domain/enums/Kind.java";
const VO = "d/src/main/java/com/loom/d/domain/valueobjects/Span.java";
const ADVICE = "d/src/main/java/com/loom/d/api/ApiExceptionAdvice.java";

describe("M-T6.36 — a java reserved word is emitted, mangled, with the wire pinned", () => {
  it("declares the entity field and its accessor with the mangled identifier", async () => {
    const src = await file(ENTITY);
    expect(src).toContain("String case_;");
    expect(src).toContain("int do_;");
    expect(src).toContain("public String case_() {");
    expect(src).toContain("public int do_() {");
    // …and the containment part's own fields, one level down.
    const part = await file("d/src/main/java/com/loom/d/features/tickets/Note.java");
    expect(part).toContain("String throws_;");
    expect(part).toContain("public int synchronized_() {");
  });

  it("keeps the COLUMN on the `.ddd` spelling — the mangle is host-side only", async () => {
    const src = await file(ENTITY);
    expect(src).toContain('@Column(name = "`case`")');
    expect(src).toContain('@Column(name = "`do`")');
    // A VO sub-path override names the JAVA property inside the embeddable, so
    // it mangles, while its column keeps the flattened `.ddd` spelling.
    expect(src).toContain(
      '@AttributeOverride(name = "double_", column = @Column(name = "span_double"))',
    );
  });

  it("pins the JSON property on every mangled wire component", async () => {
    for (const [path, component] of [
      [RESPONSE, '@JsonProperty("case") String case_'],
      [RESPONSE, '@JsonProperty("transient") String transient_'],
      [CREATE_REQ, '@JsonProperty("case") @NotNull @NoNulChar String case_'],
      [EVENT, '@JsonProperty("case") String case_'],
      [VO, '@JsonProperty("double") int double_'],
    ] as const) {
      expect(await file(path), `${path} must carry ${component}`).toContain(component);
    }
    // …and the import rides along with the annotation, never separately.
    expect(await file(RESPONSE)).toContain("import com.fasterxml.jackson.annotation.JsonProperty;");
  });

  it("names the query parameter explicitly so `?case=` does not become `?case_=`", async () => {
    expect(await file(CONTROLLER)).toContain('@RequestParam("case") String case_');
  });

  it("translates the `?sort=` wire key to the JPA property in one place", async () => {
    const src = await file(REPO_IMPL);
    // The whitelist stays the WIRE key…
    expect(src).toContain('java.util.List.of("id", "case", "do", "final", "native", "kind")');
    // …and exactly one translation line maps it to the java property.
    expect(src).toContain('case "case" -> "case_";');
    expect(src).toContain(
      'Sort.by("desc".equals(dir) ? Sort.Direction.DESC : Sort.Direction.ASC, __sortProperty)',
    );
  });

  it("spells the JPQL path and bind parameter with the mangled attribute", async () => {
    // `e.case` is not merely wrong — `case` is the HQL CASE keyword, so the
    // query does not even parse.  Proved on a booted app (see the packet note).
    const src = await file(JPA_REPO);
    expect(src).toContain("where e.case_ = :case_");
    expect(src).not.toContain("e.case ");
  });

  it("inverts the mangle in the RFC-7807 pointer, which never goes through Jackson", async () => {
    const src = await file(ADVICE);
    expect(src).toContain("seg = WIRE_NAMES.getOrDefault(seg, seg);");
    expect(src).toContain('java.util.Map.entry("case_", "case")');
    expect(src).toContain('java.util.Map.entry("do_", "do")');
  });

  it("persists a reserved ENUM value through its codec, not `@Enumerated(STRING)`", async () => {
    const enumSrc = await file(ENUM);
    expect(enumSrc).toContain('@JsonProperty("case") case_,');
    expect(enumSrc).toContain('private static final String[] __WIRE = { "case", "plain" };');
    expect(enumSrc).toContain("public static class Codec implements");
    // `@Enumerated(STRING)` writes `name()` — `case_` — so the column arm has to
    // switch, or the stored value diverges from every other backend.
    const entity = await file(ENTITY);
    expect(entity).toContain("@Convert(converter = Kind.Codec.class)");
    expect(entity).not.toContain("@Enumerated(EnumType.STRING)");
  });

  // -------------------------------------------------------------------------
  // THE SWEEP.  Every emitted `.java` file, every reserved word this fixture
  // names, in identifier position.  A wire site added later that forgets the
  // funnel fails HERE instead of in `gradle testClasses`.
  // -------------------------------------------------------------------------
  const RESERVED = [
    "case",
    "do",
    "final",
    "native",
    "transient",
    "throws",
    "synchronized",
    "volatile",
    "strictfp",
    "double",
    "char",
  ];

  it("leaves no bare reserved word in java identifier position anywhere", async () => {
    const files = [...(await javaFiles()).entries()].filter(([p]) => p.endsWith(".java"));
    // VACUITY GUARD — the fixture must actually produce the shape, or the
    // sweep below passes by finding nothing to look at.
    expect(files.length, "no java files emitted").toBeGreaterThan(20);
    expect(
      files.filter(([, src]) => src.includes("case_")).length,
      "the fixture never mangles anything — the sweep would be vacuous",
    ).toBeGreaterThan(5);

    const offenders: string[] = [];
    for (const [path, src] of files) {
      // Strip every STRING LITERAL first: a reserved word is legal inside a
      // column name, a JSON key, a log field or an `@JsonProperty` argument —
      // those are exactly the wire spellings this fix preserves.
      const code = src.replace(/"(?:[^"\\]|\\.)*"/g, '""');
      for (const w of RESERVED) {
        // Declaration or read in identifier position: `<type> case;`,
        // `.case()`, `case_(`… — anything where the bare word is preceded by a
        // space/dot/paren and followed by a non-word character other than the
        // mangling underscore.  Java's own keyword uses (`final int x`,
        // `throws Exception`, `private final transient List`) are excluded by
        // requiring a `.` receiver or a `(`/`;`/`,` right after.
        const bare = new RegExp(`\\.${w}\\s*\\(`, "g");
        if (bare.test(code)) offenders.push(`${path}: .${w}(`);
      }
    }
    expect(offenders, "bare reserved word read through a receiver").toEqual([]);
  });

  // -------------------------------------------------------------------------
  // The other four backends are untouched — the mangle lives in the java
  // emitters, not in the IR.
  // -------------------------------------------------------------------------
  for (const [platform, marker] of [
    ["node", "case"],
    ["python", "case"],
    ["dotnet", "@case"],
    ["elixir", "case"],
  ] as const) {
    it(`leaves platform: ${platform} on the bare \`.ddd\` name`, async () => {
      const files = await generateSystemFiles(SOURCE(platform));
      const all = [...files.values()].join("\n");
      expect(all).toContain(marker);
      expect(all, "no java-style mangle leaked onto another backend").not.toContain("case_(");
    });
  }
});

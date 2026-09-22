// The `If-Match` precondition grammar — one contract, five backends.
//
// A `versioned` aggregate's update is guarded by an optimistic-concurrency
// precondition the client sends in the `If-Match` request header
// (`docs/language.md` — a `token` field is "sent as an optimistic-concurrency
// precondition").  An entity-tag is a QUOTED string (RFC 9110 §8.8.3), and the
// hono and Phoenix backends already answer a read with `ETag: "3"` — so the
// spelling a spec-correct client sends back is `If-Match: "3"`.
//
// Four backends strip the quotes before converting:
//
//     node    /^(?:W\/)?(?:"(\d+)"|(\d+))$/
//     dotnet  int.TryParse(__ifMatch.ToString().Trim('"'), …)
//     python  request.headers.get("if-match", "").strip(chr(34))
//     elixir  value |> String.trim("\"") |> Integer.parse()
//
// java bound the raw header straight to `@RequestHeader(…) Integer ifMatch`,
// so Spring's default String→Integer converter ran `Integer.valueOf("\"3\"")`
// — which THROWS, answering **400 for a spec-correct request** — and threw on
// `*` too, which RFC 9110 defines as "no precondition".  Measured on a real
// JDK 21, not inferred:
//
//     Integer.valueOf(<3>)      = 3
//     Integer.valueOf(<"3">)    THROWS NumberFormatException
//     Integer.valueOf(<*>)      THROWS NumberFormatException
//
// It survived because NO generated client has ever sent the header (F-023):
// with the precondition never on the wire, the one backend that could not
// parse it was never asked to.
//
// This gate reads the EMITTED code of all five backends and asserts each one
// routes the header through a quote-stripping step.  The java arm additionally
// refuses the framework-converted numeric binding by shape, so a revert fails
// here rather than at a user's save button.
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const src = (platform: string, versioned: boolean) => `
system OccDemo {
  subdomain S {
    context C {
      aggregate Doc with crudish${versioned ? ", versioned" : ""} {
        title: string
        body: string
      }
      repository Docs for Doc { }
    }
  }
  storage p { type: postgres }
  resource r { for: C, kind: state, use: p }
  api CApi from S
  deployable api { platform: ${platform}, contexts: [C], dataSources: [r], serves: CApi, port: 3000 }
}
`;

/** Per backend: which emitted file carries the `If-Match` read, and the
 *  quote-stripping step it must route the value through.  A per-backend table
 *  rather than one generic regex — the five spell "strip the quotes" in five
 *  idioms, and a generic matcher would either miss four of them or pass on a
 *  backend that never strips at all. */
const STRIPS: Record<string, { file: RegExp; strip: RegExp }> = {
  node: {
    file: /problem-details\.ts$/,
    // The accepting regex itself: a quoted `"3"` or a bare `3`, weak tag ok.
    strip: /\/\^\(\?:W\\\/\)\?\(\?:"\(\\d\+\)"\|\(\\d\+\)\)\$\//,
  },
  dotnet: { file: /RequestContextMiddleware\.cs$/, strip: /\.Trim\('"'\)/ },
  python: { file: /_routes\.py$/, strip: /\.strip\(chr\(34\)\)/ },
  elixir: { file: /_controller\.ex$/, strip: /String\.trim\("\\""\)/ },
  // The CONTROLLER, not the helper: a row pointed at `IfMatch.java` would keep
  // passing while the controller bound the raw header to an `Integer` and never
  // called the helper at all — the helper would just sit there unused.  The
  // reachable seam is the call site.
  java: { file: /Controller\.java$/, strip: /IfMatch\.expectedVersion\(ifMatch\)/ },
};

const BACKENDS = Object.keys(STRIPS);

describe("If-Match: every backend accepts the quoted entity-tag it is sent", () => {
  it.each(BACKENDS)("%s strips the entity-tag quotes before converting", async (platform) => {
    const files = await generateSystemFiles(src(platform, true));
    const { file, strip } = STRIPS[platform]!;
    const matching = [...files].filter(([p]) => file.test(p));
    // Non-vacuity: a table row whose file regex matches nothing would make the
    // `.some(...)` below false-negative into a clean "no such file" rather than
    // a failure that names the grammar.
    expect(
      matching.map(([p]) => p),
      `${platform}: no file matched ${file}`,
    ).not.toEqual([]);
    const hit = matching.some(([, text]) => strip.test(text));
    expect(hit, `${platform}: the If-Match value never passes a quote-strip`).toBe(true);
  }, 60_000);

  it("java does not bind the header to a framework-converted number", async () => {
    // The defect's exact shape.  `Integer` here is Spring's binder, and the
    // binder throws on the quoted form every other backend accepts — so this
    // is the assertion a revert has to fail.
    const files = await generateSystemFiles(src("java", true));
    const offenders = [...files]
      .filter(([, t]) =>
        /@RequestHeader\([^)]*"If-Match"[^)]*\)\s+(?:Integer|int|Long|long)\b/.test(t),
      )
      .map(([p]) => p);
    expect(offenders, "java binds If-Match to a number Spring must convert").toEqual([]);
    // …and the header IS still read: an assertion that only forbids a shape
    // passes trivially on a backend that dropped the feature.
    const reads = [...files].filter(([, t]) => /"If-Match"/.test(t)).map(([p]) => p);
    expect(reads, "java stopped reading If-Match at all").not.toEqual([]);
  }, 60_000);

  it("the java helper is emitted wherever it is called", async () => {
    // Coherence, not conditionality: `versioned` is applied by DEFAULT to every
    // non-event-sourced aggregate (`applyDefaultVersioning`), so the interesting
    // failure is not "emitted when unused" but a controller importing a class
    // the placement step forgot to write.
    for (const versioned of [true, false]) {
      const files = await generateSystemFiles(src("java", versioned));
      const callers = [...files].filter(([, t]) => /IfMatch\.expectedVersion\(/.test(t));
      const helper = [...files.keys()].filter((p) => /IfMatch\.java$/.test(p));
      if (callers.length > 0) {
        expect(helper, "a controller calls IfMatch but the class was not placed").not.toEqual([]);
        // …and the placed class must actually strip the quotes.
        const body = files.get(helper[0]!)!;
        expect(body, "IfMatch.java does not strip the entity-tag quotes").toMatch(
          /charAt\(0\) == '"'/,
        );
        expect(body, "IfMatch.java does not treat `*` as no-precondition").toMatch(/"\*"\.equals/);
      } else {
        expect(helper, "IfMatch.java placed with no caller").toEqual([]);
      }
    }
  }, 120_000);
});

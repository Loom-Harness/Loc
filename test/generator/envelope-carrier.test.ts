import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";
import { BACKEND_LABEL, BACKENDS, type Backend } from "../fixtures/corpus/backends.js";
import { corpusSourceFor } from "../fixtures/corpus/harness.js";

// ---------------------------------------------------------------------------
// `envelope` is a SINGLE-ROW find (M-T6.57 / audit F57), ratified.
//
// `find audit(): Order envelope` means "read at most one Order": the repository
// answers `Order`, the route serialises the BARE body, and an empty result set
// is the not-found rung (404).  The keyword therefore carries NO distinct wire
// shape — it is unwrapped at each backend's find-return seam.
//
// The gate below is the strongest statement of that: the emitted project for a
// `T envelope` find must be BYTE-IDENTICAL to the same project with the carrier
// spelled away (`find audit(): Order`).  It is what the register's five-way
// split reduces to once the semantics are pinned, and it cannot be satisfied
// half-way — java's undeclared `Envelope<Order>`, dotnet's `Task<Envelope<Order>>`
// returning a bare `Order` (CS0029) and elixir's `Repo.all` + JSON-array
// controller each show up as a diff line on exactly one backend.
//
// Why this had never fired: NO `.ddd` anywhere in the repo instantiated the
// carrier (`grep -rE "\b[A-Z][A-Za-z0-9_]*\s+envelope\b" --include=*.ddd`
// returned nothing), so every compile gate was blind to it by construction.
// `test/fixtures/corpus/envelope.ddd` is the fixture that ends that.
// ---------------------------------------------------------------------------

/** The corpus fixture with every `envelope` carrier spelled away — the
 *  single-return find the carrier is ratified to MEAN. */
function withoutCarrier(source: string): string {
  const stripped = source.replaceAll(/(: Order) envelope\b/g, "$1");
  if (stripped === source) throw new Error("corpus/envelope.ddd no longer spells `Order envelope`");
  return stripped;
}

/** Parse + AST-validate + IR-validate, then emit — the gated helper, so a
 *  fixture that the product would refuse cannot silently emit here. */
const emit = (source: string): Promise<Map<string, string>> => generateSystemFiles(source);

/** The emitted BACKEND PROJECT only.  `.loom/` artefacts (the mermaid view in
 *  particular) render the DECLARED type, so they legitimately keep the source's
 *  `Order envelope` spelling — the diagram reports what was written, the code
 *  reports what it means. */
function projectFiles(files: Map<string, string>): Map<string, string> {
  return new Map([...files].filter(([p]) => !p.includes(".loom/")));
}

describe("`envelope` is a single-row find (M-T6.57)", () => {
  for (const backend of BACKENDS as readonly Backend[]) {
    it(`${BACKEND_LABEL[backend]}: \`T envelope\` emits exactly what \`T\` emits`, async () => {
      const carrier = projectFiles(await emit(corpusSourceFor("envelope", backend)));
      const bare = projectFiles(await emit(withoutCarrier(corpusSourceFor("envelope", backend))));

      expect([...carrier.keys()].sort()).toEqual([...bare.keys()].sort());
      const diverged = [...carrier].filter(([p, c]) => bare.get(p) !== c).map(([p]) => p);
      expect(
        diverged,
        `${BACKEND_LABEL[backend]}: these files differ between \`find audit(): Order envelope\` ` +
          "and `find audit(): Order`.  `envelope` is ratified as a single-row find, so the two " +
          "must emit identically.",
      ).toEqual([]);
    });
  }

  it(".NET: no emitted C# names the `Envelope<T>` carrier record", async () => {
    const files = await emit(corpusSourceFor("envelope", "dotnet"));
    const offenders = [...files]
      .filter(([p, c]) => p.endsWith(".cs") && /\bEnvelope</.test(c))
      .map(([p]) => p);
    expect(
      offenders,
      "`Envelope<T>` was declared in Domain/Common but the repository returned a bare " +
        "aggregate from a `Task<Envelope<Order>>` signature (CS0029).  The carrier is a " +
        "single-row find, so neither the record nor a reference to it should be emitted.",
    ).toEqual([]);
  });

  it("Java: no emitted source names an `Envelope<T>` type", async () => {
    const files = await emit(corpusSourceFor("envelope", "java"));
    const offenders = [...files]
      .filter(([p, c]) => p.endsWith(".java") && /\bEnvelope</.test(c))
      .map(([p]) => p);
    expect(
      offenders,
      "Java referenced `Envelope<Order>` in the repository port, the Spring Data interface " +
        "and the impl, and declared it NOWHERE — no type, no import.  The generated project " +
        "did not compile.",
    ).toEqual([]);
  });

  // The relational repository is not the only find emitter with a single-vs-list
  // fork: the DOCUMENT store and the EVENT-SOURCED fold each carry their own
  // copy of the predicate (`isDocSingleReturn` in document-emit.ts,
  // `isSingleReturn` in eventsourced-emit.ts).  A fix applied to one and missed
  // in the others is the exact shape of this defect, so both non-relational
  // truth kinds get the same byte-identity statement.
  const NON_RELATIONAL = `system EnvShapes {
  subdomain Sales {
    context Orders {
      event Opened { account: Ev id, owner: string }
      aggregate Doc shape: document, with crudish { code: string }
      aggregate Ev persistedAs: eventLog {
        owner: string
        create open(owner: string) { emit Opened { account: id, owner: owner } }
        apply(e: Opened) { owner := e.owner }
      }
      repository Docs for Doc { find pick(): Doc envelope }
      repository Evs for Ev { find pick(): Ev envelope }
    }
  }
  api OrdersApi from Sales
  storage primary { type: postgres }
  resource ordersState { for: Orders, kind: state, use: primary }
  resource ordersLog { for: Orders, kind: eventLog, use: primary }
  deployable d {
    platform: elixir
    contexts: [Orders]
    dataSources: [ordersState, ordersLog]
    serves: OrdersApi
    port: 4000
  }
}`;

  it("Phoenix: the document + event-sourced find emitters agree too", async () => {
    const carrier = projectFiles(await emit(NON_RELATIONAL));
    const bare = projectFiles(
      await emit(NON_RELATIONAL.replaceAll(/(: (?:Doc|Ev)) envelope\b/g, "$1")),
    );
    const diverged = [...carrier].filter(([p, c]) => bare.get(p) !== c).map(([p]) => p);
    expect(
      diverged,
      "the document store and the event-sourced fold each keep their OWN single-vs-list " +
        "predicate; unwrapping the carrier in the relational repository alone leaves these two " +
        "reading every row.",
    ).toEqual([]);

    const doc = [...carrier].find(([p]) => p.endsWith("doc_repository.ex"))?.[1] ?? "";
    expect(doc, "the document find must yield ONE row").toContain("List.first(results)");
  });

  it("Phoenix: an envelope find reads ONE row, not `Repo.all`", async () => {
    const files = await emit(corpusSourceFor("envelope", "vanilla"));
    const repo = [...files].find(([p]) => p.endsWith("order_repository.ex"))?.[1];
    expect(repo, "no order_repository.ex emitted").toBeDefined();
    const audit = /def audit\(\) do\n([\s\S]*?)\n {2}end/.exec(repo ?? "")?.[1] ?? "";
    expect(
      audit,
      "`audit/0` returned `Repo.all(query)` — EVERY row — and the controller answered a JSON " +
        "ARRAY, while the app's own published OpenAPI declares a single object + 404.",
    ).toContain("Repo.one(query)");
    expect(audit).not.toContain("Repo.all(");
  });
});

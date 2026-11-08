import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";
import { parseString } from "../../_helpers/parse.js";

// A repository verb (`get` / `find` / `getBy` / `findBy` / `all` / `remove`)
// on a name that is no repository.  The read is typed as a read — never as the
// collection quantifier `all(pred)` an unknown receiver falls back to — and
// `loom.repository-unknown` names the cause.  A context `test` reads by
// aggregate name, so there `Note.all()` is the `Note[]` list read.

const model = (body: string, extra = "") => `
system S {
  subdomain Sd { context C {
    aggregate Pokemon with crudish { name: string }
    aggregate Trainer with crudish { name: string  party: Pokemon id[] }
    ${extra}
    criterion HasPoke(p: Pokemon id) of Trainer = this.party.contains(p)
    ${body}
  } }
}`;

async function errors(src: string): Promise<{ code: string; message: string }[]> {
  const { diagnostics } = await parseString(src);
  return diagnostics
    .filter((d) => d.severity === 1)
    .map((d) => ({ code: String(d.code), message: d.message }));
}

describe("loom.repository-unknown", () => {
  it("names an undeclared repository and the declaration that fixes it", async () => {
    const errs = await errors(
      model(
        `queryHandler Owners(p: Pokemon id): Trainer[] { let x = Trainers.all(HasPoke(p))  return x }`,
      ),
    );
    expect(errs.map((e) => e.code)).toEqual(["loom.repository-unknown"]);
    expect(errs[0]!.message).toContain("no repository named 'Trainers' is declared in context 'C'");
    expect(errs[0]!.message).toContain("`repository Trainers for Trainer { }`");
    // Not the misleading quantifier typing.
    expect(errs[0]!.message).not.toContain("bool");
  });

  it("reports `get` on an undeclared repository too", async () => {
    const errs = await errors(
      model(`queryHandler One(t: Trainer id): Trainer { let x = Trainers.get(t)  return x }`),
    );
    expect(errs.map((e) => e.code)).toEqual(["loom.repository-unknown"]);
  });

  it("names the declared repository when a body reads by aggregate name", async () => {
    const errs = await errors(
      model(
        `queryHandler Owners(p: Pokemon id): Trainer[] { let x = Trainer.all(HasPoke(p))  return x }`,
        "repository Roster for Trainer { }",
      ),
    );
    expect(errs.map((e) => e.code)).toEqual(["loom.repository-unknown"]);
    expect(errs[0]!.message).toContain("`Roster.all(…)`");
  });

  it("asks for a repository when the aggregate has none", async () => {
    const errs = await errors(
      model(`queryHandler One(t: Trainer id): Trainer { let x = Trainer.get(t)  return x }`),
    );
    expect(errs.map((e) => e.code)).toEqual(["loom.repository-unknown"]);
    expect(errs[0]!.message).toContain("`repository Trainers for Trainer { }`");
  });

  it("stays silent on a declared repository", async () => {
    const errs = await errors(
      model(
        `queryHandler Owners(p: Pokemon id): Trainer[] { let x = Trainers.all(HasPoke(p))  return x }`,
        "repository Trainers for Trainer { }",
      ),
    );
    expect(errs).toEqual([]);
  });

  it("leaves a collection quantifier on a value alone", async () => {
    const errs = await errors(
      model(
        `queryHandler Any(t: Trainer id, p: Pokemon id): bool { let x = Trainers.get(t)  return x.party.all(q => q == p) }`,
        "repository Trainers for Trainer { }",
      ),
    );
    expect(errs).toEqual([]);
  });
});

const testModel = (body: string) => `
system P {
  subdomain S {
    context C {
      aggregate Note with crudish { text: string }
      repository Notes for Note { }
      criterion Long of Note = this.text == "long"
      test "notes" {
        ${body}
      }
    }
  }
  api A from S
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable d { platform: PLATFORM  contexts: [C]  dataSources: [st]  serves: A  port: 4000 }
}`;

describe("`Agg.all()` in a context test is the list read", () => {
  const body = `let seen = Note.all()
        expect(seen.count).toBe(0)`;

  it("types as the aggregate list, not the quantifier's bool", async () => {
    expect(await errors(testModel(body).replace("PLATFORM", "node"))).toEqual([]);
  });

  it("refuses an argument: the test read is the whole collection", async () => {
    const errs = await errors(
      testModel(`let seen = Note.all(Long)
        expect(seen.count).toBe(0)`).replace("PLATFORM", "node"),
    );
    expect(errs.map((e) => e.code)).toEqual(["loom.repo-all-arg"]);
    expect(errs[0]!.message).toContain("in a context 'test' reads the whole collection");
  });

  const read: Record<string, [string, string]> = {
    node: ["test/c.integration.test.ts", `const seen = (await repos.note.all(1, 1000, "id", "asc")).items;`],
    python: ["tests/test_c_integration.py", `seen = (await note_repo.all(1, 1000, "id", "asc")).items`],
    dotnet: ["CIntegrationTests.cs", `var seen = (await noteRepo.All(1, 1000, "id", "asc")).Items;`],
    java: ["CIntegrationTests.java", "var seen = noteRepository.findAll();"],
    elixir: ["test/c_integration_test.exs", "{:ok, %{items: seen}} = D.C.list_notes()"],
  };
  for (const [platform, [suffix, line]] of Object.entries(read)) {
    it(`${platform}: emits the repository's list read`, async () => {
      const files = await generateSystemFiles(testModel(body).replace("PLATFORM", platform));
      const hit = [...files.entries()].find(([p]) => p.endsWith(suffix));
      expect(hit, `an emitted file ending in ${suffix}`).toBeDefined();
      expect(hit![1]).toContain(line);
    });
  }
});

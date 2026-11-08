// ---------------------------------------------------------------------------
// A criterion runner (`Run<Retrieval>Async`) returns whole aggregates, so it
// hydrates every `X id[]` reference collection from its join table the way
// `GetByIdAsync` / `FindAllAsync` / `FindManyByIdsAsync` do — on EF and on
// Dapper.  Without it the collection stays `default!` (null) and the handler
// that reads it throws.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const src = (platform: string): string => `
system P {
  subdomain S {
    context C {
      aggregate Pokemon with crudish { name: string }
      aggregate Trainer with crudish { name: string  party: Pokemon id[] }
      repository Trainers for Trainer { }
      repository Pokemons for Pokemon { }
      criterion HasPoke(p: Pokemon id) of Trainer = this.party.contains(p)
      queryHandler Owners(p: Pokemon id): Trainer[] {
        let x = Trainers.all(HasPoke(p))
        return x
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
}
`;

/** The body of `RunFindAllByHasPokeAsync`, up to its closing brace. */
function runnerBody(repo: string): string {
  const start = repo.indexOf("RunFindAllByHasPokeAsync(");
  expect(start).toBeGreaterThan(-1);
  const end = repo.indexOf("\n    }\n", start);
  return repo.slice(start, end);
}

describe(".NET criterion runner hydrates X id[] reference collections", () => {
  it("EF: Run<Retrieval>Async hydrates the join rows before returning", async () => {
    const files = await generateSystemFiles(src("dotnet"));
    const repo = files.get("d/Infrastructure/Repositories/TrainerRepository.cs")!;
    const body = runnerBody(repo);
    expect(body).toContain("await HydrateReferenceCollectionsAsync(result, cancellationToken);");
    // The helper the call names is emitted.
    expect(repo).toContain("private async Task HydrateReferenceCollectionsAsync(");
  });

  it("Dapper: Run<Retrieval>Async loads the join rows before returning", async () => {
    const files = await generateSystemFiles(src("dotnet { persistence: dapper }"));
    const repo = files.get("d/Infrastructure/Repositories/TrainerRepository.cs")!;
    const body = runnerBody(repo);
    expect(body).toContain("var __roots = rows.Select(Map).ToList();");
    expect(body).toContain("await LoadRefsAsync(conn, __roots, cancellationToken);");
    expect(body).not.toContain("return rows.Select(Map).ToList();");
  });
});

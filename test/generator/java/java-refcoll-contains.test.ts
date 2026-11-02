import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// A `this.<refColl>.contains(x)` criterion over an `X id[]` field, read
// through a paged `queryHandler` (its `@Query`).  The collection is an
// `@ElementCollection` of an embeddable id (`PokemonId(UUID value)`), so a
// `:x member of e.<refColl>` JPQL throws at runtime on Hibernate 6
// ("Unsupported tuple comparison" — the element is a tuple, the bind param is
// not).  It must render as a correlated `exists` subquery with an
// embeddable-equality predicate (Hibernate decomposes it per attribute).

const SRC = `
system Pokedex {
  subdomain Battles {
    context Roster {
      aggregate Pokemon with crudish {
        species: string
        level: int
      }
      aggregate Trainer with crudish {
        name: string
        party: Pokemon id[]
      }
      repository Trainers for Trainer { }
      criterion TrainersHoldingInParty(pokemon: Pokemon id) of Trainer = this.party.contains(pokemon)
      queryHandler ListHoldingInParty(pokemon: Pokemon id): Trainer paged {
        let r = Trainers.run(TrainersHoldingInParty(pokemon))
        return r
      }
    }
  }
  api RosterApi from Battles
  storage pg { type: postgres }
  resource rosterState { for: Roster, kind: state, use: pg }
  deployable d { platform: java, contexts: [Roster], dataSources: [rosterState], serves: RosterApi, port: 4000 }
}
`;

const ROOT = "d/src/main/java/com/loom/d";

describe("java generator — refColl.contains criterion read", () => {
  it("renders `this.<refColl>.contains(x)` as a correlated exists subquery, not `member of`", async () => {
    const f = await generateSystemFiles(SRC);
    const jpa = f.get(`${ROOT}/features/trainers/TrainerJpaRepository.java`)!;
    expect(jpa, "TrainerJpaRepository emitted").toBeTruthy();
    // The Hibernate-6-safe form.
    expect(jpa).toContain(
      "select e from Trainer e where exists (select 1 from e.party party_m where party_m = :pokemon)",
    );
    // The old runtime-crashing form must be gone.
    expect(jpa).not.toContain("member of");
  });
});

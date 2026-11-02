// A page read on the Feliz (F#/Fable) frontend that names an operation the
// aggregate does not expose must fail LOUDLY in codegen.
//
// `felizTarget.buildHookUse` once mapped every operation that was not `byId` /
// `history` onto `readFieldName` (`All<Plural>`), so an unknown read rendered
// the unfiltered list's field from a model that never declared it, and the
// filtered query was never issued.  The AST validator gates this shape first
// (`Operation 'byNothing' is not declared…`), so a user never reaches codegen
// with it; the generator's own throw is the backstop for the paths that skip
// phase ④ (the api toolkit's generate-from-partial, a macro-built body).

import { describe, expect, it } from "vitest";
import { generateSystemFilesUnchecked } from "../../_helpers/generate.js";

const SRC = `
system Docs {
  subdomain Knowledge {
    context Library {
      aggregate Doc {
        title: string
        vis: string
        derived display: string = title
      }
      repository Docs for Doc
    }
  }
  api LibApi from Knowledge
  storage pg { type: postgres }
  resource libState { for: Library, kind: state, use: pg }
  ui WebApp {
    api K: LibApi
    page Browse {
      route: "/browse"
      title: "Browse"
      state { chosen: string = "public" }
      body: Stack {
        Field { "Visibility", bind: chosen },
        QueryView {
          of: K.Doc.byNothing(chosen),
          empty: Text { "No docs" },
          data: d => Text { d.title }
        }
      }
    }
  }
  deployable api { platform: node contexts: [Library] dataSources: [libState] serves: LibApi port: 8080 }
  deployable web { platform: feliz targets: api ui: WebApp { K: api } port: 3000 }
}
`;

describe("feliz page read — an undeclared operation fails LOUDLY", () => {
  it("names an undeclared operation instead of silently binding All<Plural>", async () => {
    await expect(
      generateSystemFilesUnchecked(
        SRC,
        "the subject IS the codegen backstop behind the validator gate on an undeclared read op",
      ),
    ).rejects.toThrow(/is neither a lifecycle read/);
  });
});

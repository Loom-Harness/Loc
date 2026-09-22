// Feliz workflow forms — a `WorkflowForm(runs: Y)` projects to Elmish form state
// (the workflow's params) + a PARAMLESS POST to `/api/workflows/<wf>` (204 →
// unit) + a `<Wf>Done` result that resets + navigates.  Reuses the create-form
// machinery; the delta is the `/workflows/<wf>` endpoint (no id, no decode).
// The single-page case also pins that `Feliz.Router` is opened for `Cmd.navigate`
// even without routing.  Proven via `dotnet fable` (SDK:8.0) + vite build.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";
import { parseString } from "../../_helpers/parse.js";

const WF = `
system Bank {
  api BankApi from Core
  subdomain Core {
    context Acc {
      aggregate Account with crudish { name: string  balance: money }
      repository Accounts for Account { }
      workflow openAccount transactional {
        create(name: string, initial: money) {
          precondition initial >= 0
          let a = Account.create(name: name, balance: initial)
        }
      }
    }
  }
  storage db { type: postgres }
  resource accState { for: Acc, kind: state, use: db }
  ui WebApp {
    api Bank: BankApi
    page Open {
      route: "/open"
      body: Stack {
        Heading { "Open account", level: 1 },
        WorkflowForm { runs: openAccount }
      }
    }
  }
  deployable api { platform: node contexts: [Acc] dataSources: [accState] serves: BankApi port: 3000 }
  deployable web { platform: feliz targets: api ui: WebApp { Bank: api } port: 3005 }
}
`;

async function appFs(source: string): Promise<string> {
  const files = await generateSystemFiles(source);
  return [...files.entries()].find(([p]) => p.endsWith("src/App.fs"))![1];
}
async function fsproj(source: string): Promise<string> {
  const files = await generateSystemFiles(source);
  return [...files.entries()].find(([p]) => p.endsWith("App.fsproj"))![1];
}

describe("feliz workflow forms", () => {
  it("emits a workflow-param form record + encoder", async () => {
    const app = await appFs(WF);
    expect(app).toContain(
      "type OpenAccountWorkflowForm =\n  {\n    name: string\n    initial: string\n  }",
    );
    expect(app).toContain(
      "let openAccountWorkflowForm (form: OpenAccountWorkflowForm) : JsonValue =",
    );
    expect(app).toContain("OpenAccountWorkflowForm: OpenAccountWorkflowForm");
  });

  it("emits a paramless workflow Api fn (POST /api/workflows/<wf>, 204 → unit)", async () => {
    const app = await appFs(WF);
    expect(app).toContain(
      "let runOpenAccountWorkflow (form: OpenAccountWorkflowForm) : Async<Result<unit, string>> =",
    );
    expect(app).toContain('Http.request "/api/workflows/open_account"');
    expect(app).toContain("|> Http.method POST");
    expect(app).toContain("if response.statusCode = 200 || response.statusCode = 204 then");
  });

  it("wires per-param Set Msgs + a paramless Submit + Done", async () => {
    const app = await appFs(WF);
    expect(app).toContain("| SetOpenAccountWorkflowFormName of string");
    expect(app).toContain("| SetOpenAccountWorkflowFormInitial of string");
    expect(app).toContain("| SubmitOpenAccountWorkflowForm\n"); // paramless (no `of`)
    expect(app).toContain("| OpenAccountWorkflowDone of Result<unit, string>");
  });

  it("wires the update arms (setters, paramless submit Cmd, done)", async () => {
    const app = await appFs(WF);
    expect(app).toContain(
      "  | SubmitOpenAccountWorkflowForm -> model, Cmd.OfAsync.perform Api.runOpenAccountWorkflow model.OpenAccountWorkflowForm OpenAccountWorkflowDone",
    );
    expect(app).toContain(
      '  | OpenAccountWorkflowDone (Ok ()) -> { model with OpenAccountWorkflowForm = emptyOpenAccountWorkflowForm }, Cmd.navigatePath("")',
    );
  });

  it("the WorkflowForm renders typed inputs + a validity-guarded paramless submit", async () => {
    const app = await appFs(WF);
    // `name: string` → text; `initial: money` → a `type: number` input.  Each
    // carries the `workflow-<snake(wf)>-input-<param>` testid the shared workflow
    // page object fills.
    expect(app).toContain(
      'Html.input [ prop.custom("data-testid", "workflow-open_account-input-name"); prop.className "input input-bordered w-full"; prop.placeholder "name"; prop.value model.OpenAccountWorkflowForm.name; prop.onChange (fun (v: string) -> dispatch (SetOpenAccountWorkflowFormName v)); prop.onBlur (fun _ -> dispatch (TouchOpenAccountWorkflowForm "name"))',
    );
    expect(app).toContain(
      'Html.input [ prop.custom("data-testid", "workflow-open_account-input-initial"); prop.className "input input-bordered w-full"; prop.type\'.number; prop.placeholder "initial"; prop.value model.OpenAccountWorkflowForm.initial; prop.onChange (fun (v: string) -> dispatch (SetOpenAccountWorkflowFormInitial v)); prop.onBlur (fun _ -> dispatch (TouchOpenAccountWorkflowForm "initial"))',
    );
    expect(app).toContain(
      'Html.button [ prop.custom("data-testid", "workflow-open_account-submit"); prop.className "btn btn-primary"; prop.disabled (not (Validation.openAccountWorkflowFormValid model.OpenAccountWorkflowForm)); prop.onClick (fun _ -> dispatch SubmitOpenAccountWorkflowForm); prop.text "Run OpenAccount" ]',
    );
  });

  // A single-page ui with a form still needs Feliz.Router (for Cmd.navigate).
  it("opens Feliz.Router + refs it even for a single-page form ui", async () => {
    const app = await appFs(WF);
    expect(app).toContain("open Feliz.Router");
    const proj = await fsproj(WF);
    expect(proj).toContain('Include="Feliz.Router"');
  });

  it("validates cleanly through validateLoomModel", async () => {
    const { errors } = await parseString(WF, { validate: true });
    expect(errors).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// A domain type whose name is also a BCL type the .NET `using` set brings into
// scope — #3024.
//
// `ddd new --platform dotnet --template crud` emits an aggregate named `Task`,
// and the generated project did not build AT ALL. `generate system` reported
// `0 error(s), 0 warning(s)`; `dotnet build /warnaserror` then produced 17:
//
//   CS0104 'Task' is an ambiguous reference between 'Api.Domain.Tasks.Task'
//          and 'System.Threading.Tasks.Task'
//   CS0535 'TaskRepository' does not implement 'ITaskRepository.SaveAsync(Task, …)'
//   CS0738 … 'GetByIdAsync' … does not have the matching return type of 'Task<Task?>'
//
// TWO DISTINCT SCOPES, which is why the fix has two halves:
//
//   • a file that WILDCARD-IMPORTS the domain namespace (`TaskRepository.cs`,
//     `AppDbContext.cs`, `TaskConfiguration.cs`, the CQRS handlers) sees both
//     `Task`s → CS0104. A file-scoped `using Task = <ns>.Domain.Tasks.Task;`
//     outranks a wildcard import, so the bare name binds to the DOMAIN type;
//     and because an alias is NOT generic, `Task<Task?>` still resolves as
//     BCL-`Task<>`-of-domain-`Task`, which is exactly what the interface wants.
//   • the repository INTERFACE *declares* `namespace <ns>.Domain.Tasks`, so its
//     enclosing namespace's `Task` already beat the implicit
//     `global using System.Threading.Tasks` — its `Task SaveAsync` silently
//     returned the DOMAIN type, which is the CS0535/CS0738 pair. That one needs
//     the NON-GENERIC return qualified instead.
//
// Both halves are conditional on a real collision, so a model without one emits
// byte-identical output (verified across 84 corpus/example models — this shape
// is the only one whose output moves).
// ---------------------------------------------------------------------------

const sys = (agg: string, extra = ""): string => `
system S {
  subdomain Work {
    context Work {
      aggregate ${agg} with crudish {
        title: string
        done: bool
      }
      repository ${agg}s for ${agg} { }
      ${extra}
    }
  }
  storage pg { type: postgres }
  resource st { for: Work, kind: state, use: pg }
  deployable api { platform: dotnet contexts: [Work] dataSources: [st] port: 3000 }
}
`;

async function filesOf(src: string): Promise<Map<string, string>> {
  return generateSystemFiles(src);
}

const pick = (files: Map<string, string>, suffix: string): string => {
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  if (!key)
    throw new Error(`no emitted file ending ${suffix}; have:\n${[...files.keys()].join("\n")}`);
  return files.get(key)!;
};

describe("dotnet — BCL type-name collision (#3024)", () => {
  // --- the alias half -------------------------------------------------------

  it("aliases the domain type in every file that wildcard-imports its namespace", async () => {
    const files = await filesOf(sys("Task"));
    for (const suffix of [
      "Infrastructure/Repositories/TaskRepository.cs",
      "Infrastructure/Persistence/AppDbContext.cs",
      "Infrastructure/Persistence/Configurations/TaskConfiguration.cs",
    ]) {
      expect(pick(files, suffix), suffix).toMatch(/using Task = Api\.Domain\.Tasks\.Task;/);
    }
  });

  it("aliases in the CQRS command and query handlers too", async () => {
    const files = await filesOf(sys("Task"));
    expect(pick(files, "Application/Tasks/Commands/CreateTaskHandler.cs")).toMatch(
      /using Task = Api\.Domain\.Tasks\.Task;/,
    );
    expect(pick(files, "Application/Tasks/Queries/GetTaskByIdHandler.cs")).toMatch(
      /using Task = Api\.Domain\.Tasks\.Task;/,
    );
  });

  // --- the qualified-return half -------------------------------------------

  it("qualifies the NON-GENERIC async returns on the repository interface", async () => {
    // The interface declares the domain namespace, so a bare `Task` return here
    // meant the domain type — the CS0535/CS0738 pair against its own impl.
    const iface = pick(await filesOf(sys("Task")), "Domain/Tasks/ITaskRepository.cs");
    expect(iface).toMatch(/System\.Threading\.Tasks\.Task SaveAsync\(Task aggregate,/);
    expect(iface).toMatch(/System\.Threading\.Tasks\.Task DeleteAsync\(Task aggregate,/);
  });

  it("leaves the GENERIC `Task<…>` returns alone — an alias is not generic", async () => {
    // `Task<Task?>` is already correct: the outer binds the BCL generic, the
    // inner the alias. Qualifying it would be noise, and asserting its absence
    // is what stops a future "qualify everything" sweep.
    const iface = pick(await filesOf(sys("Task")), "Domain/Tasks/ITaskRepository.cs");
    expect(iface).toMatch(/\bTask<Task\?> GetByIdAsync\(TaskId id,/);
    expect(iface).not.toMatch(/System\.Threading\.Tasks\.Task</);
  });

  // --- generality: not Task-special-cased ----------------------------------

  it("aliases a NON-`Task` colliding name (`Queue`) the same way", async () => {
    // Aliasing only `Task` left `aggregate Type` failing with the identical
    // CS0104/CS0535/CS0738 triple against `System.Type`. This is the ratchet on
    // the generalisation.
    const repo = pick(
      await filesOf(sys("Queue")),
      "Infrastructure/Repositories/QueueRepository.cs",
    );
    expect(repo).toMatch(/using Queue = Api\.Domain\.Queues\.Queue;/);
  });

  it("does NOT qualify async returns for a non-`Task` collision", async () => {
    // `Queue` is never a return type in the emitter, so the alias alone
    // suffices; qualifying returns for it would churn output for no reason.
    const iface = pick(await filesOf(sys("Queue")), "Domain/Queues/IQueueRepository.cs");
    expect(iface).toMatch(/\bTask SaveAsync\(Queue aggregate,/);
    expect(iface).not.toMatch(/System\.Threading\.Tasks\.Task/);
  });

  it("aliases in a CRITERION over a colliding candidate — what the shipped starter hit", async () => {
    // `ddd new --platform dotnet --template crud` declares
    // `criterion InProject(p: Project id) of Task`, and its emitted
    // `InProjectCriterion.cs` was the LAST file still failing: the minimal
    // repro had no criterion, so only building the real starter found it.
    const files = await filesOf(
      sys(
        "Task",
        `aggregate Project with crudish { name: string }
       repository Projects for Project { }
       criterion InProject(p: Project id) of Task = title == "x"`,
      ),
    );
    expect(pick(files, "Domain/Criteria/InProjectCriterion.cs")).toMatch(
      /using Task = Api\.Domain\.Tasks\.Task;/,
    );
  });

  // --- no false positives ---------------------------------------------------

  it("emits no alias and no qualification for an ordinary domain name", async () => {
    // The byte-identical guarantee for every model that does not collide.
    const files = await filesOf(sys("Order"));
    const repo = pick(files, "Infrastructure/Repositories/OrderRepository.cs");
    const iface = pick(files, "Domain/Orders/IOrderRepository.cs");
    const db = pick(files, "Infrastructure/Persistence/AppDbContext.cs");
    for (const [name, body] of [
      ["repo", repo],
      ["iface", iface],
      ["dbcontext", db],
    ] as const) {
      expect(body, name).not.toMatch(/^using \w+ = Api\.Domain\./m);
      expect(body, name).not.toMatch(/System\.Threading\.Tasks\.Task/);
    }
    expect(iface).toMatch(/\bTask SaveAsync\(Order aggregate,/);
  });

  it("aliases only the colliding aggregate when a context mixes both", async () => {
    const files = await filesOf(
      sys(
        "Task",
        "aggregate Order with crudish { ref: string }\n      repository Orders for Order { }",
      ),
    );
    expect(pick(files, "Infrastructure/Repositories/TaskRepository.cs")).toMatch(
      /using Task = Api\.Domain\.Tasks\.Task;/,
    );
    // The sibling's own files stay clean…
    expect(pick(files, "Infrastructure/Repositories/OrderRepository.cs")).not.toMatch(
      /^using \w+ = Api\.Domain\./m,
    );
    // …but the shared DbContext, which imports BOTH namespaces, carries the one
    // alias it needs and no more.
    const db = pick(files, "Infrastructure/Persistence/AppDbContext.cs");
    expect(db).toMatch(/using Task = Api\.Domain\.Tasks\.Task;/);
    expect(db).not.toMatch(/using Order = /);
  });
});

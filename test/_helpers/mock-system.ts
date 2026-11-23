// The smallest scaffolded model with its backend on a chosen platform: the
// `ddd new --template crud` shape, a `node` backend swapped for `mock`.

/** The `ddd new --template crud` model with its backend on `platform`. */
export const mockSystem = (platform = "mock"): string => `
system Demo {
  subdomain Core {
    context Projects with scaffoldPaged(of: TasksInProject) {
      aggregate Project with crudish {
        name: string
        invariant name.length > 0
        derived display: string = name
      }
      repository Projects for Project { }
      aggregate Task with crudish {
        title: string
        done: bool
        project: Project id
      }
      criterion InProject(p: Project id) of Task = project == p
      retrieval TasksInProject(p: Project id) of Task {
        where: InProject(p)
        sort: [title asc]
      }
      repository Tasks for Task { }
    }
  }
  api TasksApi with scaffoldPagedApi(of: TasksInProject) from Core { }
  ui WebApp with scaffold(subdomains: [Core]) { }
  storage primary { type: postgres }
  resource appState { for: Projects, kind: state, use: primary }
  deployable api {
    platform: ${platform},
    contexts: [Projects],
    dataSources: [appState],
    serves: TasksApi,
    port: 3000
  }
  deployable webApp { platform: web, targets: api, ui: WebApp, port: 3001, design: mantine }
}`;

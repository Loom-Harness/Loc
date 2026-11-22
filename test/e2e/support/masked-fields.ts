/**
 * The `masked-fields` build case shared by the frontend build harnesses.
 *
 * A `mask unless` field reaches a caller who fails the predicate as `null`, so
 * every client types it optional and every scaffolded read of it is null-safe.
 * The model reaches each read shape that has to be: a masked scalar
 * (`amount`), a masked `bool` (`flagged`, rendered three-way, not "No"), a
 * masked `provenanced` field (the `.value` hop and the lineage disclosure), and
 * a `derived` the mask taints (`total`).  The build proves the scaffolded pages
 * type-check against the optional client types.
 */

export type MaskedFieldsFramework = "react" | "vue" | "svelte" | "angular";

export function maskedFieldsSource(framework: MaskedFieldsFramework): string {
  const frameworkLine = framework === "react" ? "" : `framework: ${framework}`;
  return `
system Ledgers {
  user { id: string  role: string }
  subdomain Books {
    context Accounts {
      aggregate Ledger with crudish {
        title: string
        amount: money mask unless currentUser.role == "auditor"
        flagged: bool mask unless currentUser.role == "auditor"
        score: int provenanced immutable mask unless currentUser.role == "auditor"
        derived total: money = amount + amount
        derived display: string = title
        operation rescore(n: int) {
          requires currentUser.role == "auditor"
          score := n
        }
      }
      repository Ledgers for Ledger { }
    }
  }
  storage db { type: postgres }
  resource ledgerState { for: Accounts, kind: state, use: db }
  ui Web with scaffold(subdomains: [Books]) { ${frameworkLine} }
  deployable api { platform: node, contexts: [Accounts], dataSources: [ledgerState], port: 3000, auth: required }
  deployable web { platform: web, targets: api, ui: Web, port: 3001 }
}
`;
}

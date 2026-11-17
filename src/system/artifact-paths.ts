// Where each derived artifact lives in a generated tree.
//
// Documents people read go under `docs/` (diagrams under `docs/diagrams/`);
// machine-readable contracts other tools consume go under `contracts/`.  The
// generator reads none of them back.  Every writer and reader names a path
// through this table, so the two cannot drift.

export const ARTIFACT_PATHS = {
  domainDiagram: "docs/diagrams/domain.mmd",
  workflowsDiagram: "docs/diagrams/workflows.mmd",
  erDiagram: "docs/diagrams/er.mmd",
  sequenceDiagram: "docs/diagrams/sequence.mmd",
  deploymentDiagram: "docs/diagrams/deployment.mmd",
  traceabilityDiagram: "docs/diagrams/traceability.mmd",
  c4Model: "docs/architecture.c4",
  dataSources: "docs/datasources.md",
  traceability: "docs/traceability.md",
  coverage: "docs/coverage.md",
  gaps: "docs/gaps.md",
  traceabilityMatrix: "docs/traceability-matrix.md",
  traceabilityJson: "docs/traceability.json",
  wireSpec: "contracts/wire-spec.json",
  asyncApi: "contracts/asyncapi.yaml",
} as const;

/** The source-language message catalog (every user-visible string, keyed as
 *  D-I18N-KEY) — what translators and `ddd i18n` work from. */
export const messageCatalogPath = (sourceLocale: string): string =>
  `contracts/messages.${sourceLocale}.json`;

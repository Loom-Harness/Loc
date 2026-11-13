export declare const ACCUMULATORS: Record<string, string>;

export interface HeexCoverageReport {
  primitives: Map<string, Set<string>>;
  accumulators: Map<string, Set<string>>;
  componentScoped: Map<string, Set<string>>;
  maxComponentUses: number;
}

export interface HeexCoverageRecorder {
  setInput(name: string): void;
  uninstall(): void;
  report(): HeexCoverageReport;
}

type PrimitiveTable = Record<string, { group?: string; tsx?: (...args: never[]) => string }>;

export declare function heexRenderedPrimitives(
  registry: PrimitiveTable,
  uiCapability: (framework: string, construct: never) => { verdict: string } | undefined,
): Set<string>;

export declare function installHeexCoverage(
  registry: PrimitiveTable,
  renderedNames: ReadonlySet<string>,
): HeexCoverageRecorder;

export declare function formatHeexCoverage(report: HeexCoverageReport): {
  text: string;
  gaps: string[];
};

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

export declare function installHeexCoverage(
  registry: Record<string, { heex?: (...args: never[]) => string }>,
): HeexCoverageRecorder;

export declare function formatHeexCoverage(report: HeexCoverageReport): {
  text: string;
  gaps: string[];
};

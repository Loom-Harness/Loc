export type Need = "docker" | "hex-mirror" | "flutter" | "dotnet" | "uv";

export interface GateCmd {
  label: string;
  cmd: string;
  env?: Record<string, string>;
  needs?: Need[];
  javaWerror?: boolean;
  minutes: number;
}

export interface QueueGate {
  workflow: string;
  check: string;
  tier: "fast" | "heavy" | "runtime";
  cmds: GateCmd[];
  manual?: string;
}

export interface PathPattern {
  neg: boolean;
  glob: string;
}

export declare const QUEUE_GATES: QueueGate[];
export declare function pullRequestPaths(source: string): PathPattern[] | null;
export declare function globToRegExp(glob: string): RegExp;
export declare function reaches(filter: PathPattern[] | null, changed: string[]): boolean;

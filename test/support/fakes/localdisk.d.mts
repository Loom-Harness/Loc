// Types for the local-disk object-store fake (`localdisk.mjs`).

/** One stored file as the behavioural golden records it. */
export interface LocalDiskEffect {
  resource: string;
  key: string;
  size: number;
}

export interface LocalDiskFake {
  kind: "files";
  /** `<RES>_DIR` per resource, each an empty temporary directory. */
  env: Record<string, string>;
  root: string;
  /** Every file under each resource's directory, sorted by resource then key. */
  observe(): Promise<LocalDiskEffect[]>;
  /** Empty every resource's directory. */
  reset(): Promise<void>;
  stop(): Promise<void>;
}

export function start(opts?: {
  storage?: { name: string };
  resources?: Array<{ name: string }>;
}): Promise<LocalDiskFake>;

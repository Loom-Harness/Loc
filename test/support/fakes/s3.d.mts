// Types for the Node object-store adapter (`s3.mjs`) over `src/emulation/aws.ts`.

/** One stored object as the behavioural golden records it. */
export interface S3Effect {
  bucket: string;
  key: string;
  size: number;
  contentType: string;
}

export interface S3StartOptions {
  /** The `s3` storage the resources use; its `config.bucket` is their default. */
  storage?: { name: string; config?: { bucket?: string } };
  /** The object-store resources on that storage, by `.ddd` name. */
  resources?: Array<{ name: string; bucket?: string }>;
  host?: string;
  port?: number;
}

export interface S3Fake {
  /** `<RES>_URL_ENDPOINT`, `<RES>_URL_BUCKET` and the `AWS_*` trio. */
  env: Record<string, string>;
  /** `http://127.0.0.1:<port>`. */
  endpoint: string;
  /** The objects that exist now, sorted by bucket then key. */
  observe(): S3Effect[];
  reset(): void;
  stop(): Promise<void>;
}

export function start(opts?: S3StartOptions): Promise<S3Fake>;

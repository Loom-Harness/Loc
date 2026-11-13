// Types for the plain-JS in-process S3 fake (`s3.mjs`).

/** One stored object as the behavioural golden records it. */
export interface S3Effect {
  bucket: string;
  key: string;
  size: number;
  contentType: string;
}

export interface S3StartOptions {
  /** The `s3` storage the resources use; its `config.bucket` is pre-created. */
  storage?: { name: string; config?: { bucket?: string } };
  /** The object-store resources on that storage, by `.ddd` name. */
  resources?: Array<{ name: string; bucket?: string }>;
  /** Extra buckets to pre-create. */
  buckets?: string[];
  host?: string;
  port?: number;
}

export interface S3Fake {
  /** `<RES>_URL_ENDPOINT`, `<RES>_URL_BUCKET` and the `AWS_*` trio. */
  env: Record<string, string>;
  /** `http://127.0.0.1:<port>`. */
  endpoint: string;
  /** Every request answered, for debugging a red leg. */
  log: Array<{ method: string; bucket: string; key: string; query: string }>;
  /** The objects that exist now, sorted by bucket then key. */
  observe(): S3Effect[];
  /** Empty every bucket and drop any bucket the fake did not pre-create. */
  reset(): void;
  stop(): Promise<void>;
}

export function start(opts?: S3StartOptions): Promise<S3Fake>;

/** Strip `aws-chunked` framing from a streaming-upload body. */
export function decodeAwsChunked(buf: Buffer): Buffer;

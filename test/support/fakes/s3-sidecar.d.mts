// Types for the S3-compatible sidecar starter (`s3-sidecar.mjs`).

/** One stored object as the behavioural golden records it. */
export interface S3Effect {
  bucket: string;
  key: string;
  size: number;
  contentType: string;
}

export interface S3SidecarOptions {
  /** The `s3` storage; its `config.bucket` is each resource's default bucket. */
  storage?: { name: string; config?: { bucket?: string } };
  /** The object-store resources on that storage, by `.ddd` name. */
  resources?: Array<{ name: string; bucket?: string }>;
}

export interface S3Sidecar {
  /** `<RES>_URL_ENDPOINT`, `<RES>_URL_BUCKET` and the `AWS_*` trio. */
  env: Record<string, string>;
  endpoint: string;
  /** Every object, sorted by bucket then key, read back over the S3 API. */
  observe(): Promise<S3Effect[]>;
  /** Delete every object and bucket, then re-create the case's buckets. */
  reset(): Promise<void>;
  stop(): Promise<void>;
}

export const S3_IMAGE: string;
export function start(opts?: S3SidecarOptions): Promise<S3Sidecar>;

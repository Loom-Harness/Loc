// Shared shapes of the resource-fake infra services (each implements
// `InfraService` from `service.ts`; they are registered in `services.ts`).
// Everything crossing the infra protocol is structured-clone data, so a service
// is called from the main thread and from a deployable's `InfraPort` alike.

/** The ops of the resource-fake services (s3, ses, mailbox, disk, httpMock):
 *  each module documents its own; params and results are plain data. */
export interface ResourceOp {
  op: string;
  params: unknown;
}

/** An HTTP request a deployable's `fetch` handed to a fake endpoint. */
export interface HttpRequestData {
  method: string;
  url: string;
  /** Header names lower-cased. */
  headers: Record<string, string>;
  body: Uint8Array;
}

export interface HttpResponseData {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

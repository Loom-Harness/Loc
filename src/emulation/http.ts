// The plain-data HTTP exchange the emulated services answer.  A host turns its
// transport into these — the playground a deployable's `fetch` facade, a Node
// host a loopback server — so a service's wire behaviour is written once.

/** A request handed to an emulated endpoint. */
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

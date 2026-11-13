// The playground's fake S3 and SES endpoints: the infra worker's one `S3` and
// `Ses` (src/emulation).  The real `@aws-sdk/client-*` run unchanged in the
// deployable worker and their HTTP lands here (the worker's `fetch` facade,
// `../resource-fakes.ts`, routes any SigV4-signed s3/ses request).

import { createS3, createSes } from "../../../../src/emulation/aws.js";
import { mailbox } from "./mailbox.js";
import type { HttpRequestData, ResourceOp } from "./resource-types.js";
import type { InfraService } from "./service.js";

const s3 = createS3();
const ses = createSes({ mailbox });

export const s3Service: InfraService<ResourceOp> = {
  name: "s3",
  handle: ({ op, params: p }) => {
    if (op === "http") return s3.http(p as HttpRequestData);
    if (op === "list") return s3.list();
    throw new Error(`s3: unknown op "${op}"`);
  },
  persist: (next) => s3.persist(next),
  reset: () => s3.reset(),
};

export const sesService: InfraService<ResourceOp> = {
  name: "ses",
  handle: ({ op, params: p }) => {
    if (op === "http") return ses.http(p as HttpRequestData);
    throw new Error(`ses: unknown op "${op}"`);
  },
  reset: () => {},
};

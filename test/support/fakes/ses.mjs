// In-process Amazon SES — the fake behind a `storage <x> { type: ses }`, for a
// SaaS provider no container can stand in for.  A loopback transport over the
// emulation core's `createSes` (SendEmail and SendRawEmail, captured into a
// core `Mailbox`).  The backend's SES client reaches it through the endpoint
// override it reads (`resourceHostEnvVar("ses", …)`), with throwaway AWS
// credentials: the core does not check signatures.
//
// `observe()` is the mailbox's list in the golden's mail shape.

import { createMailbox, createSes } from "./emulation.mjs";
import { mailEffects, serveLoopback } from "./loopback.mjs";
import { resourceHostEnvVar, S3_DEV_SIDECAR } from "./resource-env.mjs";

const configValue = (storage, key) => storage?.config?.find((e) => e.key === key)?.value?.value;

/** @param {{ storage?: { name: string, config?: { key: string, value: { value: string } }[] }, resources?: { name: string }[] }} [opts] */
export async function start(opts = {}) {
  const mailbox = createMailbox();
  const ses = createSes({ mailbox });
  const server = await serveLoopback((req) => ses.http(req));
  const env = {
    AWS_ACCESS_KEY_ID: S3_DEV_SIDECAR.accessKey,
    AWS_SECRET_ACCESS_KEY: S3_DEV_SIDECAR.secretKey,
    AWS_REGION: configValue(opts.storage, "region") ?? S3_DEV_SIDECAR.region,
  };
  for (const r of opts.resources ?? []) env[resourceHostEnvVar("ses", r.name)] = server.url;
  return {
    kind: "mail",
    env,
    url: server.url,
    mailbox,
    observe: () => mailEffects(mailbox.list()),
    reset: () => mailbox.reset(),
    stop: () => server.stop(),
  };
}

// In-process SendGrid — the fake behind a `storage <x> { type: sendgrid }`, for
// a SaaS provider no container can stand in for.  A loopback transport over
// the emulation core's `createSendgrid` (`POST /v3/mail/send`, captured into a
// core `Mailbox`).  The backend's client reaches it through the endpoint
// override it reads (`resourceHostEnvVar("sendgrid", …)`); the API key is a
// placeholder the core does not check.
//
// `observe()` is the mailbox's list in the golden's mail shape.

import { createMailbox, createSendgrid } from "./emulation.mjs";
import { mailEffects, serveLoopback } from "./loopback.mjs";
import { resourceHostEnvVar } from "./resource-env.mjs";

/** @param {{ storage?: { name: string }, resources?: { name: string }[] }} [opts] */
export async function start(opts = {}) {
  const mailbox = createMailbox();
  const sendgrid = createSendgrid({ mailbox });
  const server = await serveLoopback((req) => sendgrid.http(req));
  // SendGrid keys start `SG.`; some clients refuse any other shape.
  const env = { SENDGRID_API_KEY: "SG.loom-fake.key" };
  for (const r of opts.resources ?? []) env[resourceHostEnvVar("sendgrid", r.name)] = server.url;
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

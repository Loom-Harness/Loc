// The playground's Mailbox service: the one `Mailbox` (src/emulation) of the
// infra worker behind the infra protocol.  smtp (nodemailer facade), SES
// (`aws-fake.ts`) and SendGrid (facade) all capture into it.

import { createMailbox, type MailInput } from "../../../../src/emulation/mailbox.js";
import type { ResourceOp } from "./resource-types.js";
import type { InfraService } from "./service.js";

export type { MailInput, MailMessage } from "../../../../src/emulation/mailbox.js";

/** The playground's one mailbox. */
export const mailbox = createMailbox();

export const mailboxService: InfraService<ResourceOp> = {
  name: "mailbox",
  handle({ op, params }) {
    switch (op) {
      case "capture":
        return mailbox.capture(params as MailInput);
      case "list":
        return mailbox.list();
      case "clear":
        mailbox.clear();
        return { ok: true };
      default:
        throw new Error(`mailbox: unknown op "${op}"`);
    }
  },
  persist: (next) => mailbox.persist(next),
  reset: () => mailbox.reset(),
};

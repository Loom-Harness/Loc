// The Mailbox: every mail a deployable sends lands here instead of leaving the
// browser — the playground's Mailpit.  smtp (nodemailer facade), SES (fake HTTP
// endpoint, `aws-fake.ts`) and SendGrid (facade) all capture into this one box.

import type { InfraService } from "./service.js";
import type { ResourceOp } from "./resource-types.js";

export interface MailMessage {
  id: string;
  at: string;
  via: "smtp" | "ses" | "sendgrid";
  from: string;
  to: string[];
  subject: string;
  text: string;
  html?: string;
}

export type MailInput = Omit<MailMessage, "id" | "at">;

const box: MailMessage[] = [];
let seq = 0;

export function captureMail(input: MailInput): MailMessage {
  const msg: MailMessage = { id: `mail-${++seq}`, at: new Date().toISOString(), ...input };
  box.push(msg);
  return msg;
}

export const mailboxService: InfraService<ResourceOp> = {
  name: "mailbox",
  handle({ op, params }) {
    switch (op) {
      case "capture":
        return captureMail(params as MailInput);
      case "list":
        return [...box];
      case "clear":
        box.length = 0;
        return { ok: true };
      default:
        throw new Error(`mailbox: unknown op "${op}"`);
    }
  },
  reset() {
    box.length = 0;
    seq = 0;
  },
};

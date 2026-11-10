// The Mailbox: every mail a deployable sends lands here instead of leaving the
// browser — the playground's Mailpit.  smtp (nodemailer facade), SES (fake HTTP
// endpoint, `aws-fake.ts`) and SendGrid (facade) all capture into this one box.

import type { BlobStore } from "./persist.js";
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
let store: BlobStore | null = null;

const enc = new TextEncoder();
const dec = new TextDecoder();

export function captureMail(input: MailInput): MailMessage {
  const msg: MailMessage = { id: `mail-${++seq}`, at: new Date().toISOString(), ...input };
  box.push(msg);
  store?.put("mailbox", msg.id, enc.encode(JSON.stringify(msg)));
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
        for (const m of box) store?.remove("mailbox", m.id);
        box.length = 0;
        return { ok: true };
      default:
        throw new Error(`mailbox: unknown op "${op}"`);
    }
  },
  async persist(next) {
    store = next;
    box.length = 0;
    seq = 0;
    if (!next) return;
    const loaded = [...(await next.load("mailbox")).values()].map((b) => JSON.parse(dec.decode(b)) as MailMessage);
    loaded.sort((a, b) => Number(a.id.slice(5)) - Number(b.id.slice(5)));
    box.push(...loaded);
    seq = loaded.reduce((n, m) => Math.max(n, Number(m.id.slice(5))), 0);
  },
  reset() {
    box.length = 0;
    seq = 0;
  },
};

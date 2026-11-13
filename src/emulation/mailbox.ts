// The Mailbox: every mail a deployable sends lands here instead of leaving the
// host — the emulation's Mailpit.  smtp, SES (`aws.ts`) and SendGrid all
// capture into one box per host.

import type { BlobStore } from "./blob-store.js";

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

export interface Mailbox {
  /** Store one sent mail; answers it with its id and timestamp. */
  capture(input: MailInput): MailMessage;
  /** Every captured mail, oldest first. */
  list(): MailMessage[];
  /** Drop every mail, the durable copies included. */
  clear(): void;
  /** Back the box with `store` (null → memory only) and load what it holds. */
  persist(store: BlobStore | null): Promise<void>;
  /** Drop the in-memory state (the durable copy stays). */
  reset(): void;
}

const NS = "mailbox";
const enc = new TextEncoder();
const dec = new TextDecoder();
const seqOf = (m: MailMessage): number => Number(m.id.slice(5));

export function createMailbox(opts: { store?: BlobStore | null; now?: () => Date } = {}): Mailbox {
  const box: MailMessage[] = [];
  let seq = 0;
  let store = opts.store ?? null;
  const now = opts.now ?? (() => new Date());
  return {
    capture(input) {
      const msg: MailMessage = { id: `mail-${++seq}`, at: now().toISOString(), ...input };
      box.push(msg);
      store?.put(NS, msg.id, enc.encode(JSON.stringify(msg)));
      return msg;
    },
    list: () => [...box],
    clear() {
      for (const m of box) store?.remove(NS, m.id);
      box.length = 0;
    },
    async persist(next) {
      store = next;
      box.length = 0;
      seq = 0;
      if (!next) return;
      const loaded = [...(await next.load(NS)).values()].map(
        (b) => JSON.parse(dec.decode(b)) as MailMessage,
      );
      loaded.sort((a, b) => seqOf(a) - seqOf(b));
      box.push(...loaded);
      seq = loaded.reduce((n, m) => Math.max(n, seqOf(m)), 0);
    },
    reset() {
      box.length = 0;
      seq = 0;
    },
  };
}

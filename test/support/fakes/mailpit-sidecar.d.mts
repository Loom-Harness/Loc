// Types for the plain-JS Mailpit sidecar (`mailpit-sidecar.mjs`).

export interface MailEffect {
  from: string;
  to: string[];
  subject: string;
  text: string;
}

export interface MailSidecar {
  kind: "mail";
  /** `<RES>_URL` of every mailer resource on the storage. */
  env: Record<string, string>;
  /** `smtp://[user:pass@]host:port`. */
  url: string;
  /** `host:port` of the SMTP listener, no credentials. */
  smtp: string;
  /** Base URL of Mailpit's REST API. */
  api: string;
  observe(): Promise<MailEffect[]>;
  reset(): Promise<void>;
  stop(): Promise<void>;
}

export const MAILPIT_IMAGE: string;

export function start(opts?: {
  storage?: { name: string };
  resources?: { name: string }[];
  auth?: { user: string; pass: string };
}): Promise<MailSidecar>;

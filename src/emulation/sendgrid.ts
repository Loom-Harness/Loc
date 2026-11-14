// Fake SendGrid v3 mail send — `POST <base>/v3/mail/send` with the JSON body
// every SendGrid client posts (`personalizations[].to`, `from`, `subject`,
// `content[]`), captured into a `Mailbox`.  The API key is not checked: the
// point is the round trip, not authentication.  Answers 202 with no body, as
// SendGrid does.

import type { HttpRequestData, HttpResponseData } from "./http.js";
import type { Mailbox } from "./mailbox.js";

export interface Sendgrid {
  http(req: HttpRequestData): HttpResponseData;
}

interface SendgridAddress {
  email?: unknown;
}
interface SendgridBody {
  personalizations?: { to?: SendgridAddress[]; cc?: SendgridAddress[]; subject?: unknown }[];
  from?: SendgridAddress;
  subject?: unknown;
  content?: { type?: unknown; value?: unknown }[];
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const SEND_PATH = "/v3/mail/send";

const json = (status: number, body: unknown): HttpResponseData => ({
  status,
  headers: { "content-type": "application/json" },
  body: enc.encode(JSON.stringify(body)),
});
const error = (status: number, message: string): HttpResponseData =>
  json(status, { errors: [{ message, field: null }] });
const emails = (xs: SendgridAddress[] | undefined): string[] =>
  (xs ?? []).map((a) => a.email).filter((e): e is string => typeof e === "string");

export function createSendgrid(opts: { mailbox: Mailbox }): Sendgrid {
  return {
    http(req) {
      const path = new URL(req.url).pathname;
      if (!path.endsWith(SEND_PATH)) return error(404, `No SendGrid endpoint ${path}.`);
      if (req.method.toUpperCase() !== "POST")
        return error(405, `${req.method} ${SEND_PATH} is not supported.`);
      let body: SendgridBody;
      try {
        body = JSON.parse(dec.decode(req.body)) as SendgridBody;
      } catch {
        return error(400, "The request body is not JSON.");
      }
      const content = body.content ?? [];
      const of = (type: string): string | undefined => {
        const v = content.find((c) => c.type === type)?.value;
        return typeof v === "string" ? v : undefined;
      };
      const from = typeof body.from?.email === "string" ? body.from.email : "";
      const personalizations = body.personalizations ?? [];
      if (!from || personalizations.length === 0)
        return error(400, "`from` and `personalizations` are required.");
      // One SendGrid personalization is one delivered message.
      for (const p of personalizations) {
        const subject =
          typeof p.subject === "string"
            ? p.subject
            : typeof body.subject === "string"
              ? body.subject
              : "";
        const html = of("text/html");
        opts.mailbox.capture({
          via: "sendgrid",
          from,
          to: [...emails(p.to), ...emails(p.cc)],
          subject,
          text: of("text/plain") ?? "",
          ...(html !== undefined ? { html } : {}),
        });
      }
      return { status: 202, headers: {}, body: new Uint8Array() };
    },
  };
}

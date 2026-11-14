// A raw RFC 5322 / MIME message → the parts a mailbox keeps: sender, recipients,
// subject and the plain-text body.  Enough MIME for what mail libraries send a
// text mail as: RFC 2047 encoded-word headers, quoted-printable / base64 /
// 7bit / 8bit bodies, and a multipart tree whose first `text/plain` leaf is
// the text.  Pure: `atob` and `TextDecoder` only.

export interface ParsedMail {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html?: string;
}

const latin1 = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
const fromBase64 = (s: string): Uint8Array => latin1(atob(s.replace(/\s+/g, "")));
const fromQuotedPrintable = (s: string): Uint8Array =>
  latin1(
    s
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-Fa-f]{2})/g, (_m, h: string) =>
        String.fromCharCode(Number.parseInt(h, 16)),
      ),
  );

function decodeText(bytes: Uint8Array, charset: string | undefined): string {
  try {
    return new TextDecoder(charset || "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** Decode RFC 2047 encoded-words (`=?utf-8?B?…?=`, `=?utf-8?Q?…?=`). */
export function decodeHeaderWords(value: string): string {
  return value
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(
      /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
      (_m, charset: string, enc: string, text: string) =>
        decodeText(
          enc.toUpperCase() === "B"
            ? fromBase64(text)
            : fromQuotedPrintable(text.replace(/_/g, " ")),
          charset,
        ),
    );
}

/** The headers (lower-cased names, folded lines joined) and body of a message or part. */
function split(raw: string): { headers: Record<string, string>; body: string } {
  const at = raw.search(/\r?\n\r?\n/);
  const head = at < 0 ? raw : raw.slice(0, at);
  const body = at < 0 ? "" : raw.slice(at).replace(/^\r?\n\r?\n/, "");
  const headers: Record<string, string> = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const m = /^([^:\s]+):\s*(.*)$/.exec(line);
    if (m) headers[(m[1] as string).toLowerCase()] = m[2] as string;
  }
  return { headers, body };
}

function leaf(
  headers: Record<string, string>,
  body: string,
  want: "text/plain" | "text/html",
): string | null {
  const ct = headers["content-type"] ?? "text/plain";
  const boundary = /boundary="?([^";]+)"?/i.exec(ct)?.[1];
  if (/^multipart\//i.test(ct) && boundary) {
    for (const part of body.split(`--${boundary}`).slice(1)) {
      if (part.startsWith("--")) break;
      const p = split(part.replace(/^\r?\n/, ""));
      const found = leaf(p.headers, p.body, want);
      if (found !== null) return found;
    }
    return null;
  }
  if (!ct.toLowerCase().startsWith(want)) return null;
  const enc = (headers["content-transfer-encoding"] ?? "7bit").trim().toLowerCase();
  const bytes =
    enc === "base64"
      ? fromBase64(body)
      : enc === "quoted-printable"
        ? fromQuotedPrintable(body)
        : latin1(body);
  return decodeText(bytes, /charset="?([^";]+)"?/i.exec(ct)?.[1]);
}

/** The bare addresses of an address-list header (`"A" <a@x>, b@y`). */
export function addressList(value: string | undefined): string[] {
  if (!value) return [];
  return decodeHeaderWords(value)
    .split(",")
    .map((a) => (/<([^>]*)>/.exec(a)?.[1] ?? a).trim())
    .filter(Boolean);
}

/** Parse a raw message.  `to` is the To + Cc recipients unless the envelope
 *  names them (an SMTP `RCPT TO`, SES `Destinations`). */
export function parseMail(
  raw: string,
  envelope: { from?: string; to?: string[] } = {},
): ParsedMail {
  const { headers, body } = split(raw);
  // A part ends with the CRLF before the next boundary; that line break is
  // framing, not content, so both bodies are trimmed at the end.
  const tidy = (s: string): string => s.replace(/\r\n/g, "\n").replace(/\s+$/, "");
  const text = tidy(leaf(headers, body, "text/plain") ?? "");
  const rawHtml = leaf(headers, body, "text/html");
  const html = rawHtml === null ? null : tidy(rawHtml);
  const to = envelope.to?.length
    ? [...envelope.to]
    : [...addressList(headers.to), ...addressList(headers.cc)];
  return {
    from: addressList(headers.from)[0] ?? envelope.from ?? "",
    to,
    subject: decodeHeaderWords(headers.subject ?? ""),
    text,
    ...(html !== null ? { html } : {}),
  };
}

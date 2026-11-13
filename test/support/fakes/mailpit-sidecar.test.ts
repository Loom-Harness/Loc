// The Mailpit sidecar starter.  The fast suite pins the image; the container
// round trip — a message sent over SMTP read back by `observe()`, AUTH
// enforced when asked for, `reset()` back to an empty inbox — runs under
// `LOOM_FAKES_DOCKER=1` (`npm run test:fakes-docker`).
import { readdirSync, readFileSync } from "node:fs";
import * as net from "node:net";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAILPIT_IMAGE, start } from "./mailpit-sidecar.mjs";

const WORKFLOWS = join(__dirname, "..", "..", "..", ".github", "workflows");

describe("mailpit sidecar — pins", () => {
  it("pins its image by digest", () => {
    expect(MAILPIT_IMAGE).toMatch(/^axllent\/mailpit:v[\d.]+@sha256:[0-9a-f]{64}$/);
  });

  it("every workflow's mailpit service runs the image the kit pins", () => {
    const found = readdirSync(WORKFLOWS)
      .filter((f) => f.startsWith("behavioral-e2e") || f === "email-e2e.yml")
      .flatMap((f) =>
        [
          ...readFileSync(join(WORKFLOWS, f), "utf8").matchAll(/image:\s*(axllent\/mailpit\S*)/g),
        ].map((m) => [f, m[1]]),
      );
    expect(found.length).toBeGreaterThanOrEqual(8);
    for (const [, image] of found) expect(image).toBe(MAILPIT_IMAGE);
  });
});

/** Send one plain message over SMTP, line by line; resolves with the replies. */
async function send(hostPort: string, lines: string[]): Promise<string[]> {
  const [host, port] = hostPort.split(":");
  const sock = net.connect(Number(port), host);
  sock.setEncoding("utf8");
  const replies: string[] = [];
  let buf = "";
  let waiting: (() => void) | null = null;
  sock.on("data", (d) => {
    buf += d;
    for (let m = /^\d{3} [^\r\n]*\r\n/m.exec(buf); m; m = /^\d{3} [^\r\n]*\r\n/m.exec(buf)) {
      replies.push(m[0].trim());
      buf = buf.slice(m.index + m[0].length);
      waiting?.();
    }
  });
  const next = (): Promise<void> => new Promise((r) => (waiting = r));
  await next();
  let inData = false;
  for (const l of lines) {
    sock.write(`${l}\r\n`);
    if (inData && l !== ".") continue;
    await next();
    inData = l === "DATA" && replies.at(-1)?.startsWith("354") === true;
    if (l === ".") inData = false;
  }
  sock.end();
  return replies;
}

const message = (to: string, subject: string) => [
  "EHLO t",
  "MAIL FROM:<no-reply@x.test>",
  `RCPT TO:<${to}>`,
  "DATA",
  "From: no-reply@x.test",
  `To: ${to}`,
  `Subject: ${subject}`,
  "",
  "Hello there.",
  ".",
  "QUIT",
];

describe.skipIf(process.env.LOOM_FAKES_DOCKER !== "1")("mailpit sidecar — container", () => {
  it("hands the mailer its URL, reads the inbox back, and resets it", async () => {
    const mail = await start({ resources: [{ name: "mail" }] });
    try {
      expect(mail.env).toEqual({ MAIL_URL: `smtp://${mail.smtp}` });
      await send(mail.smtp, message("b@x.test", "Hi"));
      await send(mail.smtp, message("a@x.test", "Ho"));
      expect(await mail.observe()).toEqual([
        { from: "no-reply@x.test", to: ["a@x.test"], subject: "Ho", text: "Hello there." },
        { from: "no-reply@x.test", to: ["b@x.test"], subject: "Hi", text: "Hello there." },
      ]);
      await mail.reset();
      expect(await mail.observe()).toEqual([]);
    } finally {
      await mail.stop();
    }
  }, 120_000);

  it("refuses an unauthenticated sender when AUTH is required", async () => {
    const mail = await start({ auth: { user: "u", pass: "p" } });
    try {
      expect(mail.url).toBe(`smtp://u:p@${mail.smtp}`);
      const replies = await send(mail.smtp, message("b@x.test", "Hi"));
      expect(replies.some((r) => /^5\d\d /.test(r))).toBe(true);
      expect(await mail.observe()).toEqual([]);
    } finally {
      await mail.stop();
    }
  }, 120_000);
});

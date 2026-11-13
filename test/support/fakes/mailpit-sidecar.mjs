// Mail sidecar: a real, digest-pinned Mailpit for the behavioural legs and the
// email e2e legs.
//
// Started with `docker run` (pulled through the daemon's registry mirror), or
// the workflow `services:` container CI provides, named by `LOOM_MAILPIT_SMTP`
// (`host:port`) + `LOOM_MAILPIT_API` (`http://host:port`).  The backend reaches
// it through the `<RES>_URL` its generated mailer reads, spelled by
// `src/util/resource-env.ts`.
//
// `auth: { user, pass }` starts Mailpit with SMTP AUTH required, so a backend
// that ignores the credentials in its URL fails to deliver; the URL then
// carries them.  A shared CI container is configured by its workflow.
//
// `observe()` reads the inbox back over Mailpit's REST API and returns one
// `{ from, to, subject, text }` per message — recipients sorted, the text with
// line endings normalised and trailing whitespace trimmed — sorted, so nothing
// in it varies by run or by the backend's mail library.

import { docker, runContainer, until } from "./broker-sidecar.mjs";
import { resourceEnvUrlVar } from "./resource-env.mjs";

/** Pinned by digest so a re-tag upstream cannot change a leg, and pulled from
 *  the mirror, which serves the same digest without Docker Hub's limits. */
export const MAILPIT_IMAGE =
  "mirror.gcr.io/axllent/mailpit:v1.27.10@sha256:b1f1be18af530d939a11ee8820b379e0c88eeec204d904bfad68862adced3a5a";
const SMTP_PORT = 1025;
const API_PORT = 8025;

/**
 * @param {{ storage?: { name: string }, resources?: { name: string }[], auth?: { user: string, pass: string } }} [opts]
 */
export async function start(opts = {}) {
  let container = null;
  let smtp = process.env.LOOM_MAILPIT_SMTP;
  let api = process.env.LOOM_MAILPIT_API?.replace(/\/$/, "");
  if (!smtp || !api) {
    const env = opts.auth
      ? { MP_SMTP_AUTH: `${opts.auth.user}:${opts.auth.pass}`, MP_SMTP_AUTH_ALLOW_INSECURE: "1" }
      : { MP_SMTP_AUTH_ACCEPT_ANY: "1", MP_SMTP_AUTH_ALLOW_INSECURE: "1" };
    container = runContainer(MAILPIT_IMAGE, [SMTP_PORT, API_PORT], env, [], "mail");
    smtp = `127.0.0.1:${container.hostPorts[SMTP_PORT]}`;
    api = `http://127.0.0.1:${container.hostPorts[API_PORT]}`;
  }
  const stopContainer = () => {
    if (!container) return;
    try {
      docker(["rm", "-f", container.id]);
    } catch {
      // already gone
    }
  };
  const clear = async () => {
    const r = await fetch(`${api}/api/v1/messages`, { method: "DELETE" });
    if (!r.ok) throw new Error(`mailpit: clearing the inbox → ${r.status}`);
  };
  try {
    await until("the mailpit sidecar", async () => (await fetch(`${api}/api/v1/messages`)).ok);
    await clear();
  } catch (e) {
    stopContainer();
    throw e;
  }

  const cred = opts.auth ? `${encodeURIComponent(opts.auth.user)}:${encodeURIComponent(opts.auth.pass)}@` : "";
  const url = `smtp://${cred}${smtp}`;
  const env = {};
  for (const r of opts.resources ?? []) env[resourceEnvUrlVar(r.name)] = url;

  return {
    kind: "mail",
    env,
    url,
    /** `host:port` of the SMTP listener, no credentials. */
    smtp,
    /** Base URL of Mailpit's REST API. */
    api,
    async observe() {
      const list = await (await fetch(`${api}/api/v1/messages?limit=1000`)).json();
      const out = [];
      for (const m of list.messages ?? []) {
        const full = await (await fetch(`${api}/api/v1/message/${m.ID}`)).json();
        out.push({
          from: full.From?.Address ?? "",
          to: (full.To ?? []).map((t) => t.Address).sort(),
          subject: full.Subject ?? "",
          text: String(full.Text ?? "")
            .replace(/\r\n/g, "\n")
            .replace(/\s+$/, ""),
        });
      }
      const key = (e) => JSON.stringify([e.to, e.subject, e.text, e.from]);
      return out.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
    },
    reset: clear,
    async stop() {
      stopContainer();
    },
  };
}

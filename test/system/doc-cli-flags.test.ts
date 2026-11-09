// Every `ddd <verb> --flag` the docs and the diagnostic catalog show is a flag
// that verb accepts.
//
// A reader copies a command line out of a doc or out of an error message and
// runs it; an option the CLI does not declare fails with `unknown option`.
// The flag set is read from the built CLI's own `--help` for each command and
// subcommand, so the check follows whatever the CLI really declares.
//
// Scanned: every code fence and inline code span in README.md, docs/**,
// examples/*.md and journey/**, and every line of the diagnostic message
// catalog (src/diagnostics/messages/).  A command is `ddd <verb> …`,
// `npx ddd <verb> …` or `node <…>bin/cli.js <verb> …`; its flags are the
// `-x` / `--xyz` tokens up to the end of the command (a pipe, `&&`, `;`, or a
// comment).

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const CLI = join(ROOT, "bin", "cli.js");

const help = (args: string[]): string =>
  execFileSync("node", [CLI, ...args, "--help"], { encoding: "utf8" });

/** `Commands:` section of a help text → command names. */
function subcommands(text: string): string[] {
  const section = text.split(/^Commands:\s*$/m)[1] ?? "";
  return [...section.matchAll(/^ {2}([a-z][\w-]*)/gm)]
    .map((m) => m[1] ?? "")
    .filter((c) => c !== "help");
}

/** `Options:` section of a help text → every flag spelling it declares. */
function flags(text: string): Set<string> {
  const section = (text.split(/^Options:\s*$/m)[1] ?? "").split(/^Commands:\s*$/m)[0] ?? "";
  const out = new Set<string>(["-h", "--help"]);
  for (const line of section.split("\n")) {
    const m = /^ {2}(-[^\s<[,]+(?:, ?-[^\s<[,]+)*)/.exec(line);
    for (const f of (m?.[1] ?? "").split(/,\s*/)) if (f) out.add(f);
  }
  return out;
}

/** "verb" or "verb sub" → its declared flags, for every command the CLI has. */
const COMMANDS = new Map<string, Set<string>>();
for (const verb of subcommands(help([]))) {
  const text = help([verb]);
  COMMANDS.set(verb, flags(text));
  for (const sub of subcommands(text)) COMMANDS.set(`${verb} ${sub}`, flags(help([verb, sub])));
}

// ---------------------------------------------------------------------------

function mdFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "_site") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) mdFiles(p, acc);
    else if (e.name.endsWith(".md")) acc.push(p);
  }
  return acc;
}

const MESSAGES_DIR = join(ROOT, "src", "diagnostics", "messages");
const SOURCES = [
  join(ROOT, "README.md"),
  ...mdFiles(join(ROOT, "docs")),
  ...mdFiles(join(ROOT, "examples")),
  ...mdFiles(join(ROOT, "journey")),
  ...readdirSync(MESSAGES_DIR).map((f) => join(MESSAGES_DIR, f)),
];

type Snippet = { readonly where: string; readonly text: string };

/** The code a reader would copy: fences and inline spans of a markdown file;
 *  every line of a source file. */
function snippets(file: string): Snippet[] {
  const text = readFileSync(file, "utf8");
  const rel = relative(ROOT, file);
  const lineOf = (i: number) => text.slice(0, i).split("\n").length;
  if (!file.endsWith(".md")) {
    return text.split("\n").map((l, i) => ({ where: `${rel}:${i + 1}`, text: l }));
  }
  const out: Snippet[] = [];
  const withoutFences = text.replace(
    /```[^\n]*\n([\s\S]*?)```/g,
    (whole, body: string, at: number) => {
      body.split("\n").forEach((l, i) => {
        out.push({ where: `${rel}:${lineOf(at) + 1 + i}`, text: l });
      });
      return whole.replace(/[^\n]/g, " ");
    },
  );
  for (const m of withoutFences.matchAll(/`([^`\n]+)`/g)) {
    out.push({ where: `${rel}:${lineOf(m.index)}`, text: m[1] ?? "" });
  }
  return out;
}

const INVOCATION =
  /(?:^|[\s(`'"])(?:npx\s+)?(?:ddd|node\s+\S*bin\/cli\.js)\s+([a-z][\w-]*)(?:\s+([a-z][\w-]*))?([^\n]*)/g;

type Use = { readonly where: string; readonly command: string; readonly flag: string };

function uses(s: Snippet): Use[] {
  const out: Use[] = [];
  for (const m of s.text.matchAll(INVOCATION)) {
    const verb = m[1] ?? "";
    if (!COMMANDS.has(verb)) continue;
    const sub = m[2] ?? "";
    const command = COMMANDS.has(`${verb} ${sub}`) ? `${verb} ${sub}` : verb;
    // The command ends at a shell separator or a comment.
    const rest = (m[3] ?? "").split(/\s(?:\||&&|;|#|\/\/)|[`'"]\s*$|\s—\s/)[0] ?? "";
    for (const f of rest.matchAll(/(?:^|\s)(--?[a-zA-Z][\w-]*)/g)) {
      out.push({ where: s.where, command, flag: f[1] ?? "" });
    }
  }
  return out;
}

describe("documented ddd flags are flags the CLI declares", () => {
  const all = SOURCES.flatMap(snippets).flatMap(uses);

  it("reads the CLI and reaches a real corpus", () => {
    // A help parser or matcher that silently found nothing would pass below.
    expect(COMMANDS.get("generate system")?.has("--out")).toBe(true);
    expect(COMMANDS.get("parse")?.has("--json")).toBe(true);
    expect(all.length).toBeGreaterThan(50);
    expect(new Set(all.map((u) => u.command)).size).toBeGreaterThan(5);
  });

  it("every flag shown is declared on its command", () => {
    const unknown = all
      .filter((u) => !COMMANDS.get(u.command)?.has(u.flag))
      .map((u) => `${u.where}: ddd ${u.command} ${u.flag}`);
    expect(unknown, "fix the doc or the message, or declare the flag").toEqual([]);
  });
});

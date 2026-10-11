// Starter-project templates for `ddd new` (the on-ramp verb).
//
// Pure string builders — no IR, no fs. `renderStarter` composes a shared
// DOMAIN block with a per-platform DEPLOYMENT block so the same model wires
// to whichever backend/frontend the author picked. The CLI validates the
// rendered source (via the in-memory `validate()` toolkit) before writing,
// so a template that drifts from the grammar fails fast rather than shipping
// a broken starter — `test/cli/new.test.ts` pins every combination.

import {
  BUILTIN_PACK_LATEST,
  type BuiltinPackFamily,
  type PackFormat,
  packFormatForBuiltin,
} from "../util/builtin-formats.js";

export type StarterPlatform = "node" | "dotnet" | "elixir" | "java" | "python";
export type StarterTemplate = "blank" | "crud";
/** A design pack `ddd new` can scaffold = a registered built-in pack family.
 *  Not a second hand-written union: the packs this verb offers and the packs
 *  that exist are the same set by construction. */
export type DesignPack = BuiltinPackFamily;

export const STARTER_PLATFORMS: readonly StarterPlatform[] = [
  "node",
  "dotnet",
  "elixir",
  "java",
  "python",
];
export const STARTER_TEMPLATES: readonly StarterTemplate[] = ["blank", "crud"];

/** Frontend `platform:` a pack's FORMAT scaffolds into.  `heex` packs are the
 *  exception: they mount on the Phoenix backend itself (one fullstack
 *  deployable), so they name no separate frontend platform. */
const FRONTEND_PLATFORM_FOR_FORMAT: Record<PackFormat, "react" | "svelte" | "vue" | "angular"> = {
  tsx: "react",
  svelte: "svelte",
  vue: "vue",
  angular: "angular",
  // Never read for a heex pack — `isLiveView` diverts those first — but the
  // record stays total so a NEW pack format cannot be added without deciding
  // what `ddd new` does with it.
  heex: "react",
};

/** The format the bareword `design: <family>` resolves to (via
 *  `BUILTIN_PACK_LATEST`), e.g. `mantine` → `tsx`. */
export function packFormatOf(design: DesignPack): PackFormat {
  const format = packFormatForBuiltin(design);
  if (!format) {
    // Unreachable: `design` is a registered family and every family's latest
    // version is in BUILTIN_PACK_FORMATS (pinned by builtin-pack tests).
    throw new Error(`no registered format for design pack '${design}'`);
  }
  return format;
}

/** The command that re-runs THIS CLI, derived from the process's own argv
 *  (`process.argv`: `[node, /abs/path/bin/cli.js, …]`), e.g.
 *  `node /home/me/Loc/bin/cli.js`.  `ddd new` prints this — in its `next:`
 *  hint, the `main.ddd` header and the README — instead of `npx ddd`: the
 *  scaffolded directory has no `package.json`, so `npx ddd` there resolves
 *  the unrelated public npm package named `ddd`, not Loom (ruling D11).
 *  Node hands `argv[1]` over already resolved to an absolute path, so the
 *  line works from any directory.  Falls back to `ddd` only when argv names
 *  no script (an embedder calling the CLI in-process). */
export function cliInvocation(argv: readonly string[]): string {
  const script = argv[1];
  if (!script) return "ddd";
  return `node ${shellQuote(script)}`;
}

/** POSIX-quote `s` when it holds anything a shell would split or expand. */
function shellQuote(s: string): string {
  return /^[\w./@%+=:,-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`;
}

const FORMAT_ORDER: readonly PackFormat[] = ["tsx", "vue", "svelte", "angular", "heex"];

/** Every design pack `ddd new --design` accepts, DERIVED from the built-in
 *  pack registry (`src/util/builtin-formats.ts`) and grouped by format.
 *
 *  It used to be a hand-written list, and it drifted the way hand-written
 *  lists do: seven of the thirteen registered families, so `--design vuetify`
 *  worked while `--help` denied it existed and `--design primeng` was
 *  rejected outright though the pack ships.  Deriving it means adding a pack
 *  directory + its registry entry is the whole change. */
export const DESIGN_PACKS: readonly DesignPack[] = (
  Object.keys(BUILTIN_PACK_LATEST) as DesignPack[]
)
  .slice()
  .sort(
    (a, b) =>
      FORMAT_ORDER.indexOf(packFormatOf(a)) - FORMAT_ORDER.indexOf(packFormatOf(b)) ||
      a.localeCompare(b),
  );

/** The packs of one format, in `DESIGN_PACKS` order — the grouping every
 *  human-facing list (the `--design` help, the `new` README) reads. */
export function designPacksForFormat(format: PackFormat): readonly DesignPack[] {
  return DESIGN_PACKS.filter((d) => packFormatOf(d) === format);
}

/** Backend listen port per platform (mirrors `defaultPort` in
 *  `src/platform/registry.ts`). The frontend scaffold (react or svelte) always uses 3001. */
export const BACKEND_PORT: Record<StarterPlatform, number> = {
  node: 3000,
  dotnet: 8080,
  elixir: 4000,
  java: 8081,
  python: 8000,
};
export const FRONTEND_PORT = 3001;
/** The Vue frontend's port (mirrors the vue platform's defaultPort). */
export const VUE_FRONTEND_PORT = 3003;
/** The Angular frontend's port (mirrors the angular platform's defaultPort). */
export const ANGULAR_FRONTEND_PORT = 3004;

/** Turn an arbitrary project name into a valid Loom system identifier
 *  (PascalCase, leading letter). `my-app` → `MyApp`, `123` → `App123`. */
export function toSystemName(name: string): string {
  const parts = name
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const id = parts.map((p) => p[0]!.toUpperCase() + p.slice(1)).join("");
  if (id.length === 0) return "App";
  return /^[A-Za-z]/.test(id) ? id : `App${id}`;
}

/** True when the (platform, design) pair is the Phoenix LiveView fullstack
 *  shape — one deployable that both serves the API and mounts a HEEx UI.
 *  Keyed on the pack's FORMAT, so every heex pack (coreComponents, daisyui,
 *  the next one) takes this shape without being named here. */
function isLiveView(platform: StarterPlatform, design: DesignPack): boolean {
  return platform === "elixir" && packFormatOf(design) === "heex";
}

interface DomainBlock {
  /** Source lines for the `subdomain`/`context` block (2-space indented). */
  source: string;
  /** The single bounded-context name the deployment wires to. */
  context: string;
}

function blankDomain(): DomainBlock {
  return {
    context: "Notes",
    source: `  subdomain Core {
    context Notes {
      aggregate Note with crudish {
        title: string
        body: string
        invariant title.length > 0
      }

      repository Notes for Note { }
    }
  }`,
  };
}

function crudDomain(): DomainBlock {
  return {
    context: "Projects",
    source: `  subdomain Core {
    context Projects {
      aggregate Project with crudish {
        name: string
        invariant name.length > 0
        derived display: string = name
      }

      repository Projects for Project { }

      aggregate Task with crudish {
        title: string
        done: bool
        project: Project id
      }

      // A list read is a criterion + retrieval pair, not a bespoke repository
      // find: a list-returning "find byX(...)" is deprecated
      // (loom.repository-find-deprecated), and the starter used to ship one — so
      // a fresh "ddd new" warned on its own first parse.
      criterion InProject(p: Project id) of Task = project == p
      retrieval TasksInProject(p: Project id) of Task {
        where: InProject(p)
        sort: [title asc]
      }

      repository Tasks for Task { }
    }
  }`,
  };
}

function renderDeployment(platform: StarterPlatform, design: DesignPack, context: string): string {
  const storage = `  storage primary { type: postgres }
  resource appState { for: ${context}, kind: state, use: primary }`;

  if (isLiveView(platform, design)) {
    // Phoenix LiveView on `platform: elixir`: a single fullstack deployable
    // mounts the HEEx UI.  Field order follows the grammar: …ui → port → design.
    return `${storage}

  deployable app {
    platform: elixir,
    contexts: [${context}],
    dataSources: [appState],
    ui: WebApp,
    port: ${BACKEND_PORT.elixir},
    design: ${design}
  }`;
  }

  // Backend + a separate SPA frontend.  The design pack picks the frontend
  // platform through its FORMAT (`vuetify` is a vue pack, therefore a
  // `platform: vue` deployable) — one mapping, in FRONTEND_PLATFORM_FOR_FORMAT,
  // instead of one `includes()` chain per pack family.
  const frontendPlatform = FRONTEND_PLATFORM_FOR_FORMAT[packFormatOf(design)];
  const frontendPort =
    frontendPlatform === "vue"
      ? VUE_FRONTEND_PORT
      : frontendPlatform === "angular"
        ? ANGULAR_FRONTEND_PORT
        : FRONTEND_PORT;
  return `${storage}

  deployable api {
    platform: ${platform},
    contexts: [${context}],
    dataSources: [appState],
    port: ${BACKEND_PORT[platform]}
  }

  deployable webApp {
    platform: ${frontendPlatform},
    targets: api,
    ui: WebApp,
    port: ${frontendPort},
    design: ${design}
  }`;
}

/** Render the starter `.ddd` source for the chosen template + platform. */
export function renderStarter(opts: {
  name: string;
  template: StarterTemplate;
  platform: StarterPlatform;
  design: DesignPack;
  /** The CLI invocation to print in the regenerate hint — `cliInvocation(process.argv)`. */
  invocation: string;
}): string {
  const sys = toSystemName(opts.name);
  const domain = opts.template === "crud" ? crudDomain() : blankDomain();
  const deployment = renderDeployment(opts.platform, opts.design, domain.context);

  return `// ${sys} — scaffolded by \`ddd new\` (template: ${opts.template}, platform: ${opts.platform}).
// Edit this model, then regenerate:
//   ${opts.invocation} generate system main.ddd -o . && docker compose up

system ${sys} {

  // Authentication is not wired yet.  Adding an \`auth { … }\` block (with a
  // \`user { … }\` claim shape) turns on deny-by-default, the language default
  // for an \`auth\` block: every client-reachable command and declared read on
  // an \`auth: required\` deployable must then carry a \`requires <expr>\` gate.
  // README.md § "Authentication and authorization" has the block to paste,
  // the gates it asks for, and the \`enforcement: opt\` escape.

${domain.source}

  ui WebApp with scaffold(subdomains: [Core]) {
  }

${deployment}
}
`;
}

/** The project README — platform-aware run instructions. */
export function renderReadme(opts: {
  name: string;
  platform: StarterPlatform;
  design: DesignPack;
  /** The CLI invocation to print in the run instructions — `cliInvocation(process.argv)`. */
  invocation: string;
}): string {
  const backendPort = BACKEND_PORT[opts.platform];
  const liveView = isLiveView(opts.platform, opts.design);
  // Same format→frontend mapping the model itself was rendered from, so the
  // README can never name a framework or a port the deployment doesn't use.
  const framework = FRONTEND_PLATFORM_FOR_FORMAT[packFormatOf(opts.design)];
  const frontendPort =
    framework === "vue"
      ? VUE_FRONTEND_PORT
      : framework === "angular"
        ? ANGULAR_FRONTEND_PORT
        : FRONTEND_PORT;
  const frameworkLabel = { react: "React", svelte: "Svelte", vue: "Vue", angular: "Angular" }[
    framework
  ];
  const frontendLine = liveView
    ? `- Frontend (LiveView):  http://localhost:${backendPort}`
    : `- Frontend (${frameworkLabel}): http://localhost:${frontendPort}`;

  return `# ${opts.name}

A Loom project scaffolded with \`ddd new\` — platform **${opts.platform}**${
    liveView ? " (Phoenix LiveView)" : `, frontend **${opts.design}**`
  }.

\`main.ddd\` is the single source of truth for the whole stack.

## Run it

\`\`\`bash
# 1. Generate the project tree + docker-compose.yml in place
${opts.invocation} generate system main.ddd -o .

# 2. Build and start the stack
docker compose up --build
\`\`\`

(That is the command that ran \`ddd new\`.  Not \`npx ddd\`: this directory has
no \`package.json\`, so \`npx ddd\` here fetches an unrelated npm package named
\`ddd\`.  A bare \`ddd\` works only if you linked the CLI yourself.)

Then open:

- Backend API:          http://localhost:${backendPort}
${frontendLine}

Every REST route is mounted under \`/api\`, named by the aggregate's
snake_cased plural — \`curl localhost:${backendPort}/api/<aggregates>\`, e.g. a
\`Project\` aggregate serves \`GET /api/projects\` and \`GET /api/projects/{id}\`.
The full surface is always \`GET /openapi.json\`.

## Edit the model

Change \`main.ddd\` and re-run \`${opts.invocation} generate system main.ddd -o .\`.
Generation overwrites its own output every run; pin any file you hand-edit
in \`.loomignore\` so it survives (see the comments in that file).

Schema changes become migrations, so two files have to be **committed** for
the next regenerate to produce a correct delta rather than a fresh baseline:
\`.loom/snapshots/\` (the schema the migrations have built up) and
\`.loom/main.migration-history.json\` (which versions this model has emitted).
Without the second, generating into a directory that carries no migrations —
a CI job, a fresh clone — re-issues the first migration under a version your
database has already applied, and the change silently never lands.

## Authentication and authorization

The model starts without auth.  To wire OIDC, add a claim shape and an
\`auth\` block inside \`system { … }\`, and mark the backend deployable
\`auth: required\`:

\`\`\`ddd
user {
  id: string
  role: string
  permissions: string[]
}
auth {
  oidc { issuer: env("OIDC_ISSUER") clientId: env("OIDC_CLIENT_ID") }
}
\`\`\`

An \`auth\` block is **deny-by-default** unless it says otherwise: every
client-reachable command (operations, creates, destroys, workflow starters and
handlers) and every *declared* read (repository finds, projections) must carry
a \`requires <expr>\` gate, or the build fails with
\`loom.default-deny-ungated\`.  \`requires true\` is the explicit
"intentionally public" escape.  Two things to know:

- The synthesised **list** read is coverable — declare
  \`find all(): <T>[] requires <expr>\` on the repository and the gate lands on
  \`GET /api/<plural>\`; until you do, the build *warns*
  (\`loom.default-deny-list-ungated\`).  The synthesised **by-id** read
  (\`GET /api/<plural>/{id}\`) has no gate surface yet, so the build *warns*
  about each one (\`loom.default-deny-by-id-ungated\`); a tenancy filter still
  covers it, role separation within a tenant does not.
- \`with crudish\` generates create/update/destroy — gate them by naming a
  \`policy\` and handing it to the macro:
  \`aggregate X with crudish(requires: <Policy>)\`.

To keep the older opt-in posture — only the members that declare a
\`requires\` are gated, everything else serves any authenticated caller —
say so explicitly:

\`\`\`ddd
auth {
  enforcement: opt
  oidc { issuer: env("OIDC_ISSUER") clientId: env("OIDC_CLIENT_ID") }
}
\`\`\`

See https://github.com/Loom-Harness/loc/blob/main/docs/auth.md for the full
authorization layer (\`permissions\`, \`policy\`, \`mask unless\`).

## Learn more

- Language reference: https://github.com/Loom-Harness/loc/blob/main/docs/language.md
- CLI & workflow:     https://github.com/Loom-Harness/loc/blob/main/docs/tools.md
`;
}

/** A `.loomignore` seeded with the customary pins, commented out so nothing
 *  is pinned until the author opts in (uncomments a line). */
export function renderLoomignore(): string {
  return `# .loomignore — pin files you hand-edit so \`ddd generate system\` leaves
# them alone. gitignore syntax; paths are relative to this directory.
# See https://github.com/Loom-Harness/loc/blob/main/docs/tools.md#loomignore
#
# Uncomment the entrypoints/config you customise:
# Program.cs
# /index.ts
# package.json
# *.csproj
# tsconfig.json
# drizzle.config.ts
`;
}

/**
 * MIT grant written at the root of a project `ddd new` scaffolds.  Loom
 * itself is FSL-1.1-Apache-2.0, but generated OUTPUT is licensed to the
 * user under MIT so that production users can ship it without inheriting
 * FSL terms.  The companion FAQ lives at `docs/license-faq.md` in the Loom
 * repo.
 *
 * Scaffold-time only (M-FT.13, finding G9).  `ddd generate` used to inject
 * this into the output tree on EVERY run, which silently dropped a LICENSE
 * into a directory the user may already have licensed differently — and
 * re-created it after every delete.  `ddd new` owns the project's identity
 * files (main.ddd / README.md / .loomignore), so the licence belongs with
 * them; `ddd generate` writes only build output.  A user generating into a
 * tree they did not scaffold keeps whatever LICENSE they already have.
 */
export const GENERATED_OUTPUT_LICENSE = `MIT License

Copyright (c) ${new Date().getFullYear()} the authors of this generated project.

This project was scaffolded by Loom (https://github.com/Loom-Harness/loc), a
source-available DDD code generator licensed under FSL-1.1-Apache-2.0.
The generator's license does NOT extend to this output: every file in
this directory is licensed to you under the MIT License below.  Any
runtime helper snippets that Loom embedded verbatim into this project
are dual-licensed MIT OR Apache-2.0 in this context.  See
https://github.com/Loom-Harness/loc/blob/main/docs/license-faq.md for the
full posture.

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT.  IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS
BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

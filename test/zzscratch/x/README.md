# x

A Loom project scaffolded with `ddd new` — platform **node**, frontend **mantine**.

`main.ddd` is the single source of truth for the whole stack.

## Run it

```bash
# 1. Generate the project tree + docker-compose.yml in place
node /home/user/Loc/.claude/worktrees/agent-ae1b5baca662c01c5/bin/cli.js generate system main.ddd -o .

# 2. Build and start the stack
docker compose up --build
```

(That is the command that ran `ddd new`.  Not `npx ddd`: this directory has
no `package.json`, so `npx ddd` here fetches an unrelated npm package named
`ddd`.  A bare `ddd` works only if you linked the CLI yourself.)

Then open:

- Backend API:          http://localhost:3000
- Frontend (React): http://localhost:3001

Every REST route is mounted under `/api`, named by the aggregate's
snake_cased plural — `curl localhost:3000/api/<aggregates>`, e.g. a
`Project` aggregate serves `GET /api/projects` and `GET /api/projects/{id}`.
The full surface is always `GET /openapi.json`.

## Edit the model

Change `main.ddd` and re-run `node /home/user/Loc/.claude/worktrees/agent-ae1b5baca662c01c5/bin/cli.js generate system main.ddd -o .`.
Generation overwrites its own output every run; pin any file you hand-edit
in `.loomignore` so it survives (see the comments in that file).

Schema changes become migrations once you record them.  The first time the
database has to be kept rather than recreated, run
`node /home/user/Loc/.claude/worktrees/agent-ae1b5baca662c01c5/bin/cli.js migrate add initial main.ddd`; after every later schema
change, `node /home/user/Loc/.claude/worktrees/agent-ae1b5baca662c01c5/bin/cli.js migrate add <what-changed> main.ddd` (kebab-case).
Each run writes the change to `migrations/` — **commit that directory**.
`generate` renders every backend's migrations from it, and refuses to run
while the model has a schema change that is not recorded there.

## Authentication and authorization

The model starts without auth.  To wire OIDC, add a claim shape and an
`auth` block inside `system { … }`, and mark the backend deployable
`auth: required`:

```ddd
user {
  id: string
  role: string
  permissions: string[]
}
auth {
  oidc { issuer: env("OIDC_ISSUER") clientId: env("OIDC_CLIENT_ID") }
}
```

An `auth` block is **deny-by-default** unless it says otherwise: every
client-reachable command (operations, creates, destroys, workflow starters and
handlers) and every *declared* read (repository finds, projections) must carry
a `requires <expr>` gate, or the build fails with
`loom.default-deny-ungated`.  `requires true` is the explicit
"intentionally public" escape.  Two things to know:

- Reads need a gate too — one line per aggregate in the context's
  `policy` block, `policy { read <T> requires <expr> }`, gates every read
  of it (`GET /api/<plural>`, `GET /api/<plural>/{id}`, each find).
  Ungated, the list and by-id reads are refused at runtime (403) and the
  build *warns*
  (`loom.default-deny-list-ungated` / `loom.default-deny-by-id-ungated`);
  the warnings become errors in a later release.
- `with crudish` generates create/update/destroy — gate them by naming a
  `policy` and handing it to the macro:
  `aggregate X with crudish(requires: <Policy>)`.  The paged read
  `scaffoldPaged` exposes takes the same argument:
  `context X with scaffoldPaged(of: <Read>, requires: <Policy>)`.

For the opt-in posture instead — only the members that declare a
`requires` are gated, everything else serves any authenticated caller —
say so explicitly:

```ddd
auth {
  enforcement: opt
  oidc { issuer: env("OIDC_ISSUER") clientId: env("OIDC_CLIENT_ID") }
}
```

See https://github.com/Loom-Harness/loc/blob/main/docs/auth.md for the full
authorization layer (`permissions`, `policy`, `mask unless`).

## Learn more

- Language reference: https://github.com/Loom-Harness/loc/blob/main/docs/language.md
- CLI & workflow:     https://github.com/Loom-Harness/loc/blob/main/docs/tools.md

# meridian

A Loom project scaffolded with `ddd new` — platform **node**, frontend **mantine**.

`main.ddd` is the single source of truth for the whole stack.

## Run it

```bash
# 1. Generate the project tree + docker-compose.yml in place
npx ddd generate system main.ddd -o .

# 2. Build and start the stack
docker compose up --build
```

(`npx ddd` — a bare `ddd` only works if you linked the CLI yourself; from a
clone of the Loom repo the spelling is `node bin/cli.js`.)

Then open:

- Backend API:          http://localhost:3000
- Frontend (React): http://localhost:3001

Every REST route is mounted under `/api`, named by the aggregate's
snake_cased plural — `curl localhost:3000/api/<aggregates>`, e.g. a
`Project` aggregate serves `GET /api/projects` and `GET /api/projects/{id}`.
The full surface is always `GET /openapi.json`.

## Edit the model

Change `main.ddd` and re-run `npx ddd generate system main.ddd -o .`.
Generation overwrites its own output every run; pin any file you hand-edit
in `.loomignore` so it survives (see the comments in that file).

Schema changes become migrations, so two files have to be **committed** for
the next regenerate to produce a correct delta rather than a fresh baseline:
`.loom/snapshots/` (the schema the migrations have built up) and
`.loom/main.migration-history.json` (which versions this model has emitted).
Without the second, generating into a directory that carries no migrations —
a CI job, a fresh clone — re-issues the first migration under a version your
database has already applied, and the change silently never lands.

## Learn more

- Language reference: https://github.com/Loom-Harness/loc/blob/main/docs/language.md
- CLI & workflow:     https://github.com/Loom-Harness/loc/blob/main/docs/tools.md

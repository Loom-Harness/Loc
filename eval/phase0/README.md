# fieldops-starter

A Loom project scaffolded with `ddd new` — platform **node**, frontend **mantine**.

`main.ddd` is the single source of truth for the whole stack.

## Run it

```bash
# 1. Generate the project tree + docker-compose.yml in place
ddd generate system main.ddd -o .

# 2. Build and start the stack
docker compose up --build
```

Then open:

- Backend API:          http://localhost:3000
- Frontend (React): http://localhost:3001

## Edit the model

Change `main.ddd` and re-run `ddd generate system main.ddd -o .`.
Generation overwrites its own output every run; pin any file you hand-edit
in `.loomignore` so it survives (see the comments in that file).

## Learn more

- Language reference: https://github.com/lemmit/loc/blob/main/docs/language.md
- CLI & workflow:     https://github.com/lemmit/loc/blob/main/docs/tools.md

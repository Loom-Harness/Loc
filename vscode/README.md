# Loom DDD — VS Code extension

Language support for Loom DDD `.ddd` files.  Bundles the Loom language
server so these editor features work out of the box:

- **Syntax highlighting** for keywords (`aggregate`, `entity`,
  `valueobject`, `event`, `repository`, `find`, `operation`, ...),
  primitive types, and comments, plus semantic tokens from the
  language server and the contributed **Loom Dark** color theme.
- **Hover** showing inferred types on every expression / cross-
  reference / declaration header.
- **Go-to-definition** on every cross-reference (`Customer id`,
  `contains lines: <Part>`, named-type ref, repository-for, emit,
  system subdomains + targets) plus member access (`order.lines` ->
  `Containment` declaration), and **go-to-implementation**.
- **Find references** and **rename** across every loaded `.ddd` file.
- **Completion** that's type-driven on member access (typing `.`
  on a typed receiver suggests the right members) and shows a
  `detail` label for cross-reference candidates ("aggregate",
  "valueobject", "enum", "event", "subdomain", "deployable", ...).
- **Signature help** for calls.
- **Code actions**: quick fixes for diagnostics that carry a fix hint,
  and "Unfold macro", which rewrites a `with X(...)` clause into its
  expanded source in place.
- **Workspace symbols** (Cmd+T / Ctrl+T) finding aggregates,
  entity parts, value objects, and enums across every loaded
  `.ddd` file.

The extension also adds one command-palette entry:

> **Loom: Generate from current file**
>
> Runs `ddd generate system <currentFile> -o <outDir>`.  Prompts for
> the output directory (cached in global state across runs) and
> streams the CLI's output to a Loom output channel.

## Install

The extension isn't published to the VS Code Marketplace yet.  Build
and install the `.vsix` locally:

```sh
# from the repository root, build the language server first
npm install
npm run build

# then build the extension
cd vscode
npm install
npm run build
npm run package      # produces loom-ddd-0.1.0.vsix

# install it
code --install-extension loom-ddd-0.1.0.vsix
```

Open any `.ddd` file under `examples/` to verify the behaviours
above.

## Develop

```sh
cd vscode
npm install
npm run build         # tsc + copy-server.mjs
```

In another VS Code window, open this directory and press F5 to
launch an Extension Development Host with the extension loaded.
Edit a `.ddd` file in the host window to exercise the LSP.

When you change the language server (anything under `../src/`),
re-run `npm run build` here to refresh the bundled `server/`
directory.  No need to reinstall the extension during development —
the dev host always loads from the working tree.

## Layout

- `package.json` — extension manifest (activation, language,
  grammar, theme, commands).
- `src/extension.ts` — boots the LSP client + registers the
  generate command.
- `language-configuration.json` — comment markers, brackets,
  auto-closing pairs.
- `grammars/ddd.tmLanguage.json` — the hand-maintained TextMate
  grammar; `copy-server.mjs` copies it at build time into the
  gitignored `syntaxes/` directory the manifest points at.
- `themes/loom-dark.json` — the "Loom Dark" color theme.
- `server/` — the LSP server + CLI, copied at build time from the
  parent project's `out/`.  Not checked in.

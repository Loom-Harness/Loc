phoenix/ — pack-agnostic HEEx shared-source slot.

The pack loader (src/generator/_packs/loader-fs.ts) reads every `.hbs`
file in this directory when loading a HEEx-format pack (`coreComponents`
and `daisyui`, under `designs/`), making them available as logical
shared sources alongside the pack's own templates.

The directory is empty: each HEEx pack ships its shell files (theme,
main, app-shell, sidebar, core-components, assets pipeline) directly.
This slot holds templates that should be available to every HEEx pack
without each having to re-declare them — mirroring how vite/, api/, and
docker/ supply shared sources to every TSX pack.

Drop files here as `<name>.hbs`; they become available to templates via
`{{> <name>}}` partial includes.

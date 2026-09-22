#!/usr/bin/env bash
SRC=/home/user/Loc/eval-platform/acmeship/main.ddd
CLI=/home/user/Loc/bin/cli.js
OUT=/home/user/Loc/eval-platform/matrix
mkdir -p "$OUT/gen2"; : > "$OUT/gen2-results.txt"
design_for() { case "$1" in
  react) echo "    design: mantine";;
  vue) echo "    design: vuetify";;
  svelte) echo "    design: shadcnSvelte";;
  angular) echo "    design: angularMaterial";;
  feliz) echo '    design: "corporate"';;
  flutter) echo "";;
esac }
for be in node dotnet java python elixir; do
  for fe in react vue svelte angular feliz flutter; do
    d="$OUT/gen2/$be-$fe"; rm -rf "$d"; mkdir -p "$d"
    dl=$(design_for "$fe")
    sed -e "s/^    platform: node,/    platform: $be,/" \
        -e "s/^    platform: react,/    platform: $fe,/" \
        -e "s|^    design: mantine|${dl}|" "$SRC" > "$d/main.ddd"
    if node "$CLI" generate system "$d/main.ddd" -o "$d" >"$d/generate.log" 2>&1; then
      echo "GEN_OK   $be/$fe files=$(find "$d" -type f | wc -l)" >> "$OUT/gen2-results.txt"
    else
      echo "GEN_FAIL $be/$fe :: $(grep -m1 -E 'error' "$d/generate.log" | cut -c1-180)" >> "$OUT/gen2-results.txt"
    fi
  done
done
cat "$OUT/gen2-results.txt"

#!/usr/bin/env bash
# Generate the SAME model across every backend x frontend, changing ONLY the platform lines.
SRC=/home/user/Loc/eval-platform/acmeship/main.ddd
CLI=/home/user/Loc/bin/cli.js
OUT=/home/user/Loc/eval-platform/matrix
mkdir -p "$OUT/gen"
: > "$OUT/gen-results.txt"
for be in node dotnet java python elixir; do
  for fe in react vue svelte angular feliz flutter; do
    d="$OUT/gen/$be-$fe"
    rm -rf "$d"; mkdir -p "$d"
    sed -e "s/^    platform: node,/    platform: $be,/" \
        -e "s/^    platform: react,/    platform: $fe,/" "$SRC" > "$d/main.ddd"
    log="$d/generate.log"
    if node "$CLI" generate system "$d/main.ddd" -o "$d" >"$log" 2>&1; then
      n=$(find "$d" -type f | wc -l)
      echo "GEN_OK   $be/$fe files=$n" >> "$OUT/gen-results.txt"
    else
      echo "GEN_FAIL $be/$fe :: $(grep -m2 -E 'error|Error' "$log" | tr '\n' ' ' | cut -c1-200)" >> "$OUT/gen-results.txt"
    fi
  done
done
cat "$OUT/gen-results.txt"

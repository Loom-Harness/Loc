#!/usr/bin/env bash
# One-command sandbox toolchain bootstrap.
#
#   scripts/sandbox-bootstrap.sh [java|dotnet|elixir|node24|flutter|all ...]
#   source /opt/loom-tc/env.sh        # puts the toolchains on PATH
#
# A fresh cloud container has Node 22, JDK 21 + Gradle 8, Python, the Docker
# client (no daemon), psql and Playwright Chromium.  The emitted projects
# target JDK 25 + Gradle 9, .NET 10, Elixir/OTP 27 and Flutter, so the runtime
# suites for those targets need the toolchains on the HOST (the behavioural
# runners shell out to `gradle`, `dotnet`, `mix`, `flutter` from Node).  This
# script starts dockerd, lifts each toolchain out of the pinned image into
# $LOOM_TC_DIR/<name>, and writes $LOOM_TC_DIR/env.sh.
#
# Idempotent: a target with a `.ok` marker is skipped.  Fail-soft: a target
# that fails (pull 429, disk full, ...) is reported and the rest still run;
# the exit code is 1 when any requested target failed.
#
# Env: LOOM_TC_DIR (default /opt/loom-tc), LOOM_TC_KEEP_IMAGES=1 (keep pulled
# images; by default each is removed after extraction to spare the per-session
# disk allowance), LOOM_TC_FORCE=1 (ignore markers).
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TC="${LOOM_TC_DIR:-/opt/loom-tc}"
ALL=(java dotnet elixir node24 flutter)

# Image tags come from the constants the generators pin, so a bump moves the
# bootstrap with it.  The fallbacks are the values at the time of writing.
JAVA_V="$(grep -oP 'JAVA_VERSION = "\K[0-9]+' "$ROOT/src/generator/java/emit/program.ts" 2>/dev/null || echo 25)"
ELIXIR_V="$(grep -oP 'ARG ELIXIR_VERSION=\K[0-9.]+' "$ROOT/src/generator/elixir/shell/project.ts" 2>/dev/null | head -1)"
OTP_V="$(grep -oP 'ARG OTP_VERSION=\K[0-9.]+' "$ROOT/src/generator/elixir/shell/project.ts" 2>/dev/null | head -1)"
DEB_V="$(grep -oP 'ARG DEBIAN_VERSION=\K[a-z0-9-]+' "$ROOT/src/generator/elixir/shell/project.ts" 2>/dev/null | head -1)"
DOTNET_V="$(grep -oP 'FROM mcr.microsoft.com/dotnet/sdk:\K[0-9.]+(?= AS build)' "$ROOT/src/generator/dotnet/emit/program.ts" 2>/dev/null | head -1)"
IMG_JAVA="gradle:9-jdk${JAVA_V}"
IMG_DOTNET="mcr.microsoft.com/dotnet/sdk:${DOTNET_V:-10.0}"
IMG_ELIXIR="hexpm/elixir:${ELIXIR_V:-1.18.4}-erlang-${OTP_V:-27.3.4}-debian-${DEB_V:-bookworm-20260610-slim}"
IMG_NODE="node:24"
IMG_FLUTTER="ghcr.io/cirruslabs/flutter:stable"

log() { printf '[sandbox-bootstrap] %s\n' "$*" >&2; }

ensure_dockerd() {
  docker info >/dev/null 2>&1 && return 0
  log "starting dockerd"
  (dockerd >/tmp/dockerd.log 2>&1 &)
  local i
  for i in $(seq 1 45); do
    docker info >/dev/null 2>&1 && return 0
    sleep 1
  done
  log "dockerd did not come up; see /tmp/dockerd.log"
  return 1
}

# pull <image>: retry Docker Hub 429s, then fall back to mirror.gcr.io, which
# serves Docker Hub images (`gradle`, `node`, `hexpm/elixir`) without the Hub
# rate limit.  Images on other registries (mcr.microsoft.com, ghcr.io) have no
# mirror and are only retried.
pull() {
  local img="$1" n mirror
  for n in 1 2 3; do
    docker pull -q "$img" >/dev/null 2>&1 && return 0
    sleep $((n * 5))
  done
  case "$img" in
    */*/*) return 1 ;;                          # registry-qualified (mcr, ghcr)
    */*)   mirror="mirror.gcr.io/$img" ;;
    *)     mirror="mirror.gcr.io/library/$img" ;;
  esac
  docker pull -q "$mirror" >/dev/null 2>&1 && docker tag "$mirror" "$img"
}

# extract <image> <name> <src:dest>...   (dest is relative to $TC/<name>)
extract() {
  local img="$1" name="$2"; shift 2
  local dir="$TC/$name" cid spec
  rm -rf "$dir"; mkdir -p "$dir" || return 1
  pull "$img" || { log "$name: cannot pull $img"; return 1; }
  cid="$(docker create "$img" true)" || return 1
  for spec in "$@"; do
    mkdir -p "$(dirname "$dir/${spec#*:}")"
    docker cp "$cid:${spec%%:*}" "$dir/${spec#*:}" >/dev/null || { docker rm "$cid" >/dev/null; return 1; }
  done
  docker rm "$cid" >/dev/null
  [ "${LOOM_TC_KEEP_IMAGES:-}" = 1 ] || docker rmi "$img" >/dev/null 2>&1 || true
}

do_java()   { extract "$IMG_JAVA" java /opt/java/openjdk:jdk /opt/gradle:gradle \
                && "$TC/java/jdk/bin/java" -version 2>&1 | head -1 >&2; }
do_dotnet() { extract "$IMG_DOTNET" dotnet /usr/share/dotnet:dotnet \
                && "$TC/dotnet/dotnet/dotnet" --version >&2; }
# The generic `elixir:` image does NOT work on the host: its crypto NIF wants
# OPENSSL_3.4.0.  The hexpm builds link the host's OpenSSL 3.0 fine.
do_elixir() { extract "$IMG_ELIXIR" elixir /usr/local/lib/elixir:elixir /usr/local/lib/erlang:erlang \
                && PATH="$TC/elixir/erlang/bin:$TC/elixir/elixir/bin:$PATH" ELIXIR_ERL_OPTIONS="+fnu" elixir --version 2>&1 | tail -1 >&2; }
do_node24() { extract "$IMG_NODE" node24 /usr/local/bin/node:bin/node /usr/local/lib/node_modules:lib/node_modules \
                && ln -sf ../lib/node_modules/npm/bin/npm-cli.js "$TC/node24/bin/npm" \
                && ln -sf ../lib/node_modules/npm/bin/npx-cli.js "$TC/node24/bin/npx" \
                && "$TC/node24/bin/node" --version >&2; }
do_flutter() { extract "$IMG_FLUTTER" flutter /sdks/flutter:flutter || return 1
               "$TC/flutter/flutter/bin/flutter" --version --no-version-check 2>&1 | grep -m1 "^Flutter" >&2
               # the behavioural runners import esbuild from test/behavioral
               [ -d "$ROOT/test/behavioral/node_modules/esbuild" ] || (cd "$ROOT/test/behavioral" && npm install --silent >&2) || true; }

write_env() {
  {
    echo "# generated by scripts/sandbox-bootstrap.sh — source me"
    [ -f "$TC/java/.ok" ]    && echo "export JAVA_HOME=$TC/java/jdk; export PATH=$TC/java/gradle/bin:$TC/java/jdk/bin:\$PATH"
    [ -f "$TC/dotnet/.ok" ]  && echo "export DOTNET_ROOT=$TC/dotnet/dotnet DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1; export PATH=$TC/dotnet/dotnet:\$PATH"
    [ -f "$TC/elixir/.ok" ]  && echo "export ELIXIR_ERL_OPTIONS=+fnu; export PATH=$TC/elixir/erlang/bin:$TC/elixir/elixir/bin:\$PATH"
    [ -f "$TC/node24/.ok" ]  && echo "export PATH=$TC/node24/bin:\$PATH"
    [ -f "$TC/flutter/.ok" ] && echo "export PATH=$TC/flutter/flutter/bin:\$PATH"
  } > "$TC/env.sh"
}

targets=("$@"); [ ${#targets[@]} -eq 0 ] && targets=(all)
[ "${targets[0]}" = all ] && targets=("${ALL[@]}")

mkdir -p "$TC" || { log "cannot create $TC"; exit 1; }
ensure_dockerd || log "no docker daemon: only already-extracted targets will be reported"

failed=()
for t in "${targets[@]}"; do
  case "$t" in java|dotnet|elixir|node24|flutter) ;; *) log "unknown target '$t' (java|dotnet|elixir|node24|flutter|all)"; failed+=("$t"); continue ;; esac
  if [ -f "$TC/$t/.ok" ] && [ "${LOOM_TC_FORCE:-}" != 1 ]; then log "$t: already present"; continue; fi
  log "$t: extracting"
  if ( "do_$t" ); then touch "$TC/$t/.ok"; log "$t: ok"; else rm -f "$TC/$t/.ok"; failed+=("$t"); log "$t: FAILED"; fi
done

write_env
log "env file: $TC/env.sh  (source it, or: eval \"\$(cat $TC/env.sh)\")"
if [ ${#failed[@]} -gt 0 ]; then log "failed: ${failed[*]}"; exit 1; fi

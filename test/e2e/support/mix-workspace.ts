// ---------------------------------------------------------------------------
// Build many generated Phoenix projects in one job without rebuilding their
// dependencies for each one.
//
// Every generated project fetches and compiles the same Phoenix/Ecto/OTel
// closure, and that build (prod, then test) is nearly all of a project's
// minute; the project's own `lib/` compiles in seconds.  So projects are
// grouped by their exact `deps` block, each group's closure is fetched and
// compiled ONCE into a template (`deps/`, `mix.lock`, and every dependency
// under `_build/{prod,test}/lib`), and each project starts from a copy of it.
// Mix then finds every dependency fetched, locked and built, and compiles only
// the project itself.  The verdict is unchanged: the copy holds no project
// code, and `mix compile --warnings-as-errors` / `mix test` still build the
// project from source.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { HexMirror } from "./hex-mirror.js";
import { mixDepsGet, mixLocalInstall } from "./mix-retry.js";
import { sh, shResult } from "./parallel.js";

/** The elixir image every Phoenix compile gate runs in — keep the gates in lockstep. */
export const ELIXIR_IMAGE = "hexpm/elixir:1.18.4-erlang-27.3.4-debian-bookworm-20260610-slim";

/** Shell snippet that seeds `/app` from the template mounted at `/tpl`. */
export const SEED_FROM_TEMPLATE = "cp -a /tpl/deps /tpl/_build /tpl/mix.lock /app/";

/**
 * Proves a container can use the shared archives the way `mix deps.get` will:
 * start Hex (the call that fails with `{"no such file or directory", "hex.app"}`
 * on a half-unpacked archive) and find rebar3.  Free of single quotes, since it
 * runs inside `bash -c '…'`.
 */
export const VERIFY_ARCHIVES =
  'mix run --no-mix-exs -e "Mix.Hex.start()" && ls /root/.mix/elixir/*/rebar3 >/dev/null';

/** The hash of a project's `defp deps do … end` block — its dependency set. */
export function depsSignature(projDir: string): string {
  const mix = fs.readFileSync(path.join(projDir, "mix.exs"), "utf8");
  const block = mix.match(/defp deps do[\s\S]*?\n {2}end/)?.[0];
  if (!block) throw new Error(`${projDir}/mix.exs: no \`defp deps do … end\` block`);
  return createHash("sha256").update(block).digest("hex").slice(0, 16);
}

/** One gate's working area: its temp root, hex/mix caches and built templates. */
export class MixWorkspace {
  /** Every project, template and copy this gate writes. */
  readonly root: string;
  /** Hex package cache, mounted at `/root/.hex` by every container. */
  private readonly hexCache: string;
  /** Hex/rebar archives: installed once by {@link ready}, then mounted read-only at `/root/.mix`. */
  private readonly mixHome: string;
  private readonly templates = new Map<string, Promise<string>>();
  private archivesInstalled: Promise<void> | undefined;
  private archivesReady = false;
  /** Set once the gate has started (or declined to start) its hex mirror. */
  mirror: HexMirror | undefined;

  constructor(prefix: string) {
    this.root = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
    this.hexCache = path.join(os.tmpdir(), `${prefix}-hex`);
    this.mixHome = path.join(os.tmpdir(), `${prefix}-mix`);
    fs.mkdirSync(this.hexCache, { recursive: true });
    fs.mkdirSync(this.mixHome, { recursive: true });
  }

  /**
   * A `docker run` of `snippet` in the elixir image: host network (or the
   * mirror's), the hex package cache, `mounts` and `env`, and the Hex/rebar
   * archives from {@link ready} mounted READ-ONLY.  The container installs
   * nothing: every concurrent container reads the one archive `ready()` wrote
   * and verified, and an accidental install fails on the read-only mount
   * instead of rewriting the archive under its siblings.
   * `snippet` is spliced into a single-quoted `bash -c`, so it must not
   * contain a single quote.
   */
  dockerRun(mounts: string, env: string, snippet: string): string {
    if (!this.archivesReady) {
      throw new Error(
        "MixWorkspace.dockerRun() before `await ready()` (or `seededMounts()`): the " +
          "container would start without the Hex/rebar archives it mounts read-only",
      );
    }
    return this.container(`${mounts} ${this.archiveMount(true)}`, env, snippet);
  }

  /** The archive dir's mount — read-only everywhere except the one install. */
  private archiveMount(readOnly: boolean): string {
    return `-v ${this.mixHome}:/root/.mix${readOnly ? ":ro" : ""}`;
  }

  private container(mounts: string, env: string, snippet: string): string {
    const dockerArgs = this.mirror ? `${this.mirror.dockerArgs.join(" ")} ` : "--network host ";
    const shellPrefix = this.mirror?.shellPrefix ?? "";
    return (
      `docker run --rm ${dockerArgs}${mounts.trim()} -v ${this.hexCache}:/root/.hex ` +
      `-w /app ${env}${ELIXIR_IMAGE} bash -c '${shellPrefix}${snippet}'`
    );
  }

  /**
   * Install Hex and rebar into the shared archive dir ONCE, in one container,
   * then prove a fresh container can start Hex from it — and throw if it
   * cannot, before any fixture runs.
   *
   * The install is `--force`, never a bare `--if-missing`: without `--force`,
   * `mix local.hex` asks `Are you sure you want to install …? [Yn]` and reads
   * the answer from stdin.  These containers have no stdin, so a closed stream
   * answers it and the install can silently not happen (reproduced in the
   * pinned image: exit 0, no archive written).  Every concurrent container
   * then finds no Hex and unpacks it into the same mount at once, deleting the
   * directory under each other (`could not remove … hex-2.6.0: file already
   * exists`, then `Could not start Hex … hex.app` on every retry).  So the
   * install happens here, is verified here, and {@link dockerRun} never
   * installs.
   */
  ready(): Promise<void> {
    this.archivesInstalled ??= (async () => {
      await sh(this.container(this.archiveMount(false), "", mixLocalInstall()), {
        timeout: 600_000,
      });
      const verify = await shResult(this.container(this.archiveMount(true), "", VERIFY_ARCHIVES), {
        timeout: 120_000,
      });
      if (verify.status !== 0) {
        throw new Error(
          `Hex/rebar were installed into ${this.mixHome}, but a fresh container cannot use ` +
            `them (\`${VERIFY_ARCHIVES}\` exited ${verify.status}):\n${verify.output}`,
        );
      }
      this.archivesReady = true;
    })();
    return this.archivesInstalled;
  }

  /** The template for a project's dependency set, built on first use. */
  template(projDir: string): Promise<string> {
    const sig = depsSignature(projDir);
    let built = this.templates.get(sig);
    if (!built) {
      built = (async () => {
        await this.ready();
        const dir = path.join(this.root, "deps", sig);
        fs.mkdirSync(dir, { recursive: true });
        // The project's mix.exs and config: dependency compilation reads the
        // config (Application.compile_env), so the template is built under a
        // real one rather than none.
        fs.copyFileSync(path.join(projDir, "mix.exs"), path.join(dir, "mix.exs"));
        fs.cpSync(path.join(projDir, "config"), path.join(dir, "config"), { recursive: true });
        await sh(
          this.dockerRun(
            `-v ${dir}:/app`,
            "",
            `${mixDepsGet()} && MIX_ENV=prod mix deps.compile && MIX_ENV=test mix deps.compile`,
          ),
          { timeout: 1_200_000 },
        );
        return dir;
      })();
      this.templates.set(sig, built);
    }
    return built;
  }

  /** Mounts for a run that seeds `projDir` from its template (see SEED_FROM_TEMPLATE). */
  async seededMounts(projDir: string): Promise<string> {
    return `-v ${projDir}:/app -v ${await this.template(projDir)}:/tpl:ro`;
  }

  /**
   * Remove a dir's root-owned build output from inside a container.  The
   * containers run as root and leave root-owned `deps/` + `_build/` in the
   * mounted dir; a non-root CI runner cannot delete them, and a hundred
   * dependency copies would fill its disk.  Best-effort: the verdict is
   * already decided.
   */
  async remove(dir: string): Promise<void> {
    await shResult(`docker run --rm -v ${dir}:/out ${ELIXIR_IMAGE} rm -rf /out`, {
      timeout: 120_000,
    });
  }
}

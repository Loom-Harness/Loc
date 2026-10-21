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
  /** Hex/rebar archives, mounted at `/root/.mix` so `--if-missing` fetches them once. */
  private readonly mixHome: string;
  private readonly templates = new Map<string, Promise<string>>();
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
   * mirror's), both caches, `mounts`, `env`, and the Hex/rebar install first.
   * `snippet` is spliced into a single-quoted `bash -c`, so it must not
   * contain a single quote.
   */
  dockerRun(mounts: string, env: string, snippet: string): string {
    const dockerArgs = this.mirror ? `${this.mirror.dockerArgs.join(" ")} ` : "--network host ";
    const shellPrefix = this.mirror?.shellPrefix ?? "";
    return (
      `docker run --rm ${dockerArgs}${mounts} -v ${this.hexCache}:/root/.hex ` +
      `-v ${this.mixHome}:/root/.mix -w /app ${env}${ELIXIR_IMAGE} ` +
      `bash -c '${shellPrefix}${mixLocalInstall({ ifMissing: true })} && ${snippet}'`
    );
  }

  /** The template for a project's dependency set, built on first use. */
  template(projDir: string): Promise<string> {
    const sig = depsSignature(projDir);
    let built = this.templates.get(sig);
    if (!built) {
      built = (async () => {
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

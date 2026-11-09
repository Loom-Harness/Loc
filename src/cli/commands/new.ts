import * as fs from "node:fs";
import * as path from "node:path";
import type { Command } from "commander";
import { validate } from "../../api/index.js";
import {
  cliInvocation,
  DESIGN_PACKS,
  type DesignPack,
  designPacksForFormat,
  GENERATED_OUTPUT_LICENSE,
  packFormatOf,
  renderLoomignore,
  renderReadme,
  renderStarter,
  STARTER_PLATFORMS,
  STARTER_TEMPLATES,
  type StarterPlatform,
  type StarterTemplate,
} from "../new-templates.js";

interface NewOptions {
  platform?: string;
  template?: string;
  design?: string;
  out?: string;
  force?: boolean;
}

/**
 * `ddd new <name>` — scaffold a small, provably-valid starter project
 * (https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/proposals/quickstart-and-day-one-batteries.md §3.1).  Picks the
 * backend platform (`--platform`) and frontend (`--design`: a React pack, or
 * `coreComponents` for a Phoenix LiveView fullstack), renders a `main.ddd` +
 * `README.md` + `.loomignore` + `LICENSE` (the MIT grant over the generated
 * output — scaffold-time only, see `GENERATED_OUTPUT_LICENSE`), validates the
 * rendered model in-memory, and only then writes.  Validate-only — the README points the author at
 * `ddd generate system` to emit the runnable tree.
 */
async function runNew(name: string, options: NewOptions): Promise<void> {
  // Clean user-facing failure — a flag mistake is guidance, not a crash, so
  // print the message without a stack trace (the top-level catch prints stacks).
  const fail = (msg: string): never => {
    console.error(`ddd new: ${msg}`);
    process.exit(1);
  };

  // --- resolve + validate flags (fail fast, write nothing) ---
  const platformDefaulted = options.platform === undefined;
  const platform = (options.platform ?? "node") as StarterPlatform;
  if (!STARTER_PLATFORMS.includes(platform)) {
    fail(`unknown --platform "${options.platform}". Valid: ${STARTER_PLATFORMS.join(" | ")}.`);
  }
  const template = (options.template ?? "crud") as StarterTemplate;
  if (!STARTER_TEMPLATES.includes(template)) {
    fail(`unknown --template "${options.template}". Valid: ${STARTER_TEMPLATES.join(" | ")}.`);
  }
  // Frontend: a React pack for node/dotnet (default mantine); a Phoenix
  // LiveView (coreComponents) is the default for elixir.
  const design = (options.design ??
    (platform === "elixir" ? "coreComponents" : "mantine")) as DesignPack;
  if (!DESIGN_PACKS.includes(design)) {
    fail(`unknown --design "${options.design}". Valid: ${DESIGN_PACKS.join(" | ")}.`);
  }
  // A HEEx pack renders Phoenix LiveView markup, so it can only mount on the
  // elixir backend.  Keyed on the pack's format, not on one pack's name —
  // `daisyui` is as much a LiveView pack as `coreComponents`.
  if (packFormatOf(design) === "heex" && platform !== "elixir") {
    fail(
      `--design ${design} requires --platform elixir (it is a Phoenix LiveView pack). ` +
        `For ${platform}, pick one of: ${DESIGN_PACKS.filter((d) => packFormatOf(d) !== "heex").join(" | ")}.`,
    );
  }

  const outDir = path.resolve(options.out ?? name);
  if (fs.existsSync(outDir) && fs.readdirSync(outDir).length > 0 && !options.force) {
    fail(`directory not empty: ${outDir} (use --force to scaffold into it anyway).`);
  }

  // --- render + soundness check (guards against template drift) ---
  const invocation = cliInvocation(process.argv);
  const source = renderStarter({ name, template, platform, design, invocation });
  const report = await validate(source, { path: "main.ddd" });
  if (!report.ok) {
    console.error("ddd new: the generated starter failed validation (please report this):");
    for (const d of report.diagnostics) {
      if (d.severity === "error") console.error(`  ${d.message}`);
    }
    process.exit(1);
  }

  // --- write the starter files ---
  const files = new Map<string, string>([
    ["main.ddd", source],
    ["README.md", renderReadme({ name, platform, design, invocation })],
    [".loomignore", renderLoomignore()],
    // The MIT grant over the generated output (docs/license-faq.md).  Written
    // HERE, once, at scaffold time — `ddd generate` no longer drops it into
    // whatever tree it is pointed at (finding G9).
    ["LICENSE", GENERATED_OUTPUT_LICENSE],
  ]);
  for (const [rel, content] of files) {
    const full = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
  }

  // --- report + the platform hint ---
  const where = options.out ?? name;
  console.log(
    `Scaffolded ${files.size} file(s) in ${outDir} (platform: ${platform}, template: ${template}).`,
  );
  if (platformDefaulted) {
    console.log(
      "  platform: node (default) — also: dotnet, elixir, java, python (re-run with --platform <p>)",
    );
  }
  // The invocation that actually ran, not a bare `ddd` (a clone's `npm
  // install` links no global binary — F-001) and not `npx ddd` (outside the
  // clone that resolves an unrelated npm package — ruling D11, item 37).
  console.log(
    `  next: cd ${where} && ${invocation} generate system main.ddd -o . && docker compose up`,
  );
}

/** The `--design` help line, DERIVED from the pack registry.
 *
 *  It was a prose list, and it named seven of the thirteen registered pack
 *  families — so `--design vuetify` worked while `--help` said no such pack
 *  existed, and the three Angular packs were invisible.  Deriving it means
 *  `--help` cannot disagree with what `--design` accepts. */
function designHelp(): string {
  const groups: [string, readonly DesignPack[]][] = [
    ["React", designPacksForFormat("tsx")],
    ["Vue", designPacksForFormat("vue")],
    ["Svelte", designPacksForFormat("svelte")],
    ["Angular", designPacksForFormat("angular")],
    ["Phoenix LiveView, --platform elixir", designPacksForFormat("heex")],
  ];
  const rendered = groups
    .filter(([, packs]) => packs.length > 0)
    .map(([label, packs]) => `${packs.join(" | ")} (${label})`)
    .join("; ");
  return `frontend design pack — ${rendered} (default: mantine, or coreComponents on elixir)`;
}

/** Registers `ddd new` on the CLI program. */
export function registerNewCommand(program: Command): void {
  program
    .command("new <name>")
    .description(
      "Scaffold a starter .ddd project (main.ddd + README + .loomignore), validated before writing. Pick the backend with --platform and the frontend with --design.",
    )
    .option("--platform <platform>", `backend: ${STARTER_PLATFORMS.join(" | ")} (default: node)`)
    .option(
      "--template <template>",
      `starter model: ${STARTER_TEMPLATES.join(" | ")} (default: crud)`,
    )
    .option("--design <pack>", designHelp())
    .option("-o, --out <dir>", "output directory (default: ./<name>)")
    .option("--force", "scaffold into an existing, non-empty directory")
    .action(async (name: string, options: NewOptions) => {
      await runNew(name, options);
    });
}

import type { Command } from "commander";
import {
  runI18nApprove,
  runI18nCheck,
  runI18nExport,
  runI18nExtract,
  runI18nImport,
  runI18nInit,
  runI18nPrune,
  runI18nStatus,
  runI18nSync,
} from "../i18n/index.js";

/** Registers `ddd i18n` on the CLI program. */
export function registerI18nCommand(program: Command): void {
  const i18n = program
    .command("i18n")
    .description(
      "Translator workflow: extract user-visible strings and three-way-merge locale files.",
    );

  i18n
    .command("extract <file>")
    .description(
      "Write the fresh source catalog to <out>/.loom/messages.<source>.json (phases ①–⑥, no codegen).",
    )
    .option("-o, --out <dir>", "output directory (default: the .ddd file's dir)")
    .action(async (file: string, options: { out?: string }) => {
      await runI18nExtract(file, options);
    });

  i18n
    .command("init <file> <locale>")
    .description(
      "Scaffold an empty locales/<locale>/<ns>.json set (untranslated = absent) and the source lock if absent; `en-XA` is the generated pseudo-locale.",
    )
    .option("--dir <dir>", "translator tree root (default: <.ddd file's dir>/locales)")
    .action(async (file: string, locale: string, options: { dir?: string }) => {
      await runI18nInit(file, locale, options);
    });

  i18n
    .command("sync <file>")
    .description(
      "Three-way merge (lock=BASE, locale=OURS, fresh extraction=THEIRS) for every locale; bump the lock.",
    )
    .option("--dir <dir>", "translator tree root (default: <.ddd file's dir>/locales)")
    .option("--locale <locale>", "sync only this locale")
    .option(
      "--keep-stale",
      "park translations of source-deleted keys in locales/.loom/stale/ instead of dropping them",
    )
    .action(
      async (file: string, options: { dir?: string; locale?: string; keepStale?: boolean }) => {
        await runI18nSync(file, options);
      },
    );

  i18n
    .command("status <file>")
    .description("Report what `sync` would do; exit non-zero if any locale has pending changes.")
    .option("--dir <dir>", "translator tree root (default: <.ddd file's dir>/locales)")
    .option("--locale <locale>", "check only this locale")
    .action(async (file: string, options: { dir?: string; locale?: string }) => {
      await runI18nStatus(file, options);
    });

  i18n
    .command("check <file>")
    .description(
      "CI gate: per locale, invalid ICU / placeholder / plural-form mismatches, untranslated keys, translations needing review and obsolete keys.",
    )
    .option("--dir <dir>", "translator tree root (default: <.ddd file's dir>/locales)")
    .option("--locale <locale>", "check only this locale")
    .option("--strict", "exit non-zero if any finding is present (or there are no locale files)")
    .action(async (file: string, options: { dir?: string; locale?: string; strict?: boolean }) => {
      await runI18nCheck(file, options);
    });

  i18n
    .command("approve <file> [keys...]")
    .description(
      "Clear the needs-review flag on translations still correct after a source change (all open flags when no key is given).",
    )
    .option("--dir <dir>", "translator tree root (default: <.ddd file's dir>/locales)")
    .option("--locale <locale>", "approve only in this locale")
    .action(async (file: string, keys: string[], options: { dir?: string; locale?: string }) => {
      await runI18nApprove(file, keys, options);
    });

  i18n
    .command("export <file>")
    .description(
      "Write one locale as XLIFF 1.2 or gettext PO for a translation tool (context, state and previous source included).",
    )
    .requiredOption("--locale <locale>", "the locale to export")
    .option("--format <format>", "xliff | po", "xliff")
    .option("-o, --out <file>", "output file (default: <dir>/.loom/exchange/<locale>.xlf|.po)")
    .option("--dir <dir>", "translator tree root (default: <.ddd file's dir>/locales)")
    .action(
      async (
        file: string,
        options: { locale: string; format?: string; out?: string; dir?: string },
      ) => {
        await runI18nExport(file, options);
      },
    );

  i18n
    .command("import <file> <exchange>")
    .description(
      "Read a translated XLIFF / PO back into the locale files; invalid ICU, placeholders or plural forms are rejected (exit 1).",
    )
    .option("--locale <locale>", "target locale (default: the file's own language header)")
    .option("--format <format>", "xliff | po (default: from the file extension)")
    .option("--dir <dir>", "translator tree root (default: <.ddd file's dir>/locales)")
    .action(
      async (
        file: string,
        exchange: string,
        options: { locale?: string; format?: string; dir?: string },
      ) => {
        await runI18nImport(file, exchange, options);
      },
    );

  i18n
    .command("prune <file>")
    .description(
      "Delete keys the source no longer emits from every locale file (off by default; run deliberately).",
    )
    .option("--dir <dir>", "translator tree root (default: <.ddd file's dir>/locales)")
    .option("--locale <locale>", "prune only this locale")
    .action(async (file: string, options: { dir?: string; locale?: string }) => {
      await runI18nPrune(file, options);
    });
}

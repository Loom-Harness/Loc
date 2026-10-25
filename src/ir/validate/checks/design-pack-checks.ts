// ---------------------------------------------------------------------------
// Custom design packs are LOADED and checked before codegen.
//
// `design: "<path>"` names a user-supplied pack directory.  The AST validator
// cannot open it (it runs in the browser too) and says only
// `loom.design-pack-custom-unchecked`; every way the pack can be malformed —
// no `pack.json`, no `emits`, a missing `.hbs`, an unknown `stack`, a missing
// required primitive, a bad or undeclared chrome string, an ICU hole in a HEEx
// template, a `shellFiles` key not in `emits`, a template that does not parse —
// would otherwise surface as an uncoded crash out of the pack loader.
//
// Phase ⑦ is pure, so it does not read the disk itself: the host hands it a
// `DesignPackInspector` (the CLI passes `fsDesignPackInspector`), and the
// inspector's defect list is the SAME one the loader refuses on
// (`src/generator/_packs/pack-defects.ts`, vocabulary in
// `src/util/design-pack-defects.ts`).  With no inspector — the browser
// playground, the in-memory `src/api/` toolkit — the check is skipped and the
// AST warning is the whole story, exactly as before.
//
// One error per deployable: a format that does not match the framework is
// `loom.design-pack-format-mismatch` (the code a built-in pack of the wrong
// format gets, and every other defect follows from it); anything else is one
// `loom.design-pack-invalid` naming the defects.
// ---------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import {
  builtinPackNamesForFormat,
  expectedFrameworkFor,
  expectedPackFormatFor,
} from "../../../language/validators/data/platform-rules.js";
import { parseBuiltinDesignRef } from "../../../util/builtin-formats.js";
import {
  type DesignPackInspector,
  describePackDefects,
} from "../../../util/design-pack-defects.js";
import type { EnrichedSystemIR } from "../../types/loom-ir.js";
import type { LoomDiagnostic } from "./diagnostic.js";

export function validateCustomDesignPacks(
  sys: EnrichedSystemIR,
  inspect: DesignPackInspector | undefined,
  diags: LoomDiagnostic[],
): void {
  if (inspect === undefined) return;
  for (const d of sys.deployables) {
    const design = d.design;
    if (design === undefined || parseBuiltinDesignRef(design) !== null) continue;
    const framework = d.uiFramework ?? expectedFrameworkFor(d.platform, !!d.uiName);
    const expectedFormat = expectedPackFormatFor(framework);
    // Feliz (a daisyUI theme name) and Flutter (no pack at all) have no `.hbs`
    // pack pipeline; their `design:` is checked by the AST validator.
    if (expectedFormat === undefined) continue;
    const inspection = inspect(design, d.designBaseDir);
    if (inspection === null) continue;
    const source = `${sys.name}/${d.name}`;
    if (inspection.format !== undefined && inspection.format !== expectedFormat) {
      diags.push({
        severity: "error",
        message: diagMessage("loom.design-pack-format-mismatch", {
          design,
          actualFormat: inspection.format,
          framework,
          expectedFormat,
          menu: builtinPackNamesForFormat(expectedFormat),
        }),
        source,
        code: "loom.design-pack-format-mismatch",
      });
      continue;
    }
    if (inspection.defects.length === 0) continue;
    diags.push({
      severity: "error",
      message: diagMessage("loom.design-pack-invalid", {
        design,
        name: d.name,
        defects: describePackDefects(inspection.defects),
      }),
      source,
      code: "loom.design-pack-invalid",
    });
  }
}

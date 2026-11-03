// The source-language text overrides live with the other i18n seam helpers
// (`_i18n/source-text.ts`) so a backend reaching `ruleText` does not reach the
// frontend walker; frontends keep importing it through this path.
export * from "../_i18n/source-text.js";

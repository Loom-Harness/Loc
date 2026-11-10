// The `FileRef` wire record a `File` value travels as (docs/language-reference
// 04-type-system.md, `File`): what a frontend or `test e2e` body reads off one.

/** Each `FileRef` member and its JSON scalar. */
export const FILE_REF_MEMBERS: ReadonlyMap<string, "string" | "long"> = new Map([
  ["url", "string"],
  ["key", "string"],
  ["contentType", "string"],
  ["size", "long"],
]);

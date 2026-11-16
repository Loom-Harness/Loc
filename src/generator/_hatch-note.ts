// The one sentence every generated extern-hook contract carries, beside the
// declaration a compiler error points at when the user's implementation no
// longer matches it: the fix is in the model and a regeneration, not in the
// generated file.
export const HOOK_CONTRACT_NOTE =
  "Generated from the model: after a model change, change the .ddd (not this file) and run `ddd generate system … --merge`.";

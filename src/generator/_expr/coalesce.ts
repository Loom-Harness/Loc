/** `??` cannot mix with `||` / `&&` / `?:` unparenthesised; keep plain
 *  identifier/member/call chains bare and parenthesise anything else. */
export function nullishOperand(text: string): string {
  return /^[\w$.]+(\([^()]*\))?$/.test(text) ? text : `(${text})`;
}

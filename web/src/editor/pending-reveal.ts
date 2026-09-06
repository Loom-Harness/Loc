// A `revealRange` requested before any editor handle exists.
//
// `LoomEditor` installs a queueing stand-in handle on its FIRST RENDER, which
// covers the "mounted, but Monaco not created yet" window.  It cannot cover the
// window before that: the editor lives behind a lazy chunk, so between first
// paint and its mount `editorHandleRef.current` is `null` and a
// `?.revealRange(...)` is a silent no-op.
//
// That window is not theoretical.  The first-run card's *Write .ddd* door is on
// screen at first paint and does nothing but reveal 1:1 and focus, so a click
// landing before the editor chunk arrives dropped the user nowhere — the card
// closed and focus stayed where it was.  The window WIDENED when
// `editor/fix-hint-actions.ts` stopped statically importing `src/api`: that took
// eager JS from 12.96 MB to 1.74 MB, so the shell now paints long before the
// editor is ready, and what used to be unreachable became the common case.
//
// The queue therefore lives at module scope — outside the component that drains
// it — precisely because that component may not exist yet.  One slot: a later
// reveal supersedes an earlier one, which is what "put the cursor here" means.
import type { EditorRange } from "./editor-handle";

let pending: EditorRange | null = null;

/** Remember a reveal for whenever an editor next mounts. */
export function queueReveal(range: EditorRange): void {
  pending = range;
}

/** Take the queued reveal, if any, and clear it. */
export function takeQueuedReveal(): EditorRange | null {
  const queued = pending;
  pending = null;
  return queued;
}

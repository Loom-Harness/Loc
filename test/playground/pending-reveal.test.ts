import { describe, expect, it } from "vitest";
import {
  type FocusTarget,
  queueReveal,
  replayMayFocus,
  takeQueuedReveal,
} from "../../web/src/editor/pending-reveal.js";

// A reveal queued before the editor mounts replays seconds later; it must not
// pull focus out of a form the user is typing in by then.

const range = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 };
const el = (tagName: string, isContentEditable = false): FocusTarget => ({
  tagName,
  isContentEditable,
});
const outside = (): boolean => false;

describe("pending reveal", () => {
  it("is taken once", () => {
    queueReveal(range);
    expect(takeQueuedReveal()).toEqual(range);
    expect(takeQueuedReveal()).toBeNull();
  });

  it("does not take focus from a field the user is typing in", () => {
    expect(replayMayFocus(el("INPUT"), outside)).toBe(false);
    expect(replayMayFocus(el("textarea"), outside)).toBe(false);
    expect(replayMayFocus(el("SELECT"), outside)).toBe(false);
    expect(replayMayFocus(el("DIV", true), outside)).toBe(false);
  });

  it("focuses when nothing editable holds focus, or the editor itself does", () => {
    expect(replayMayFocus(null, outside)).toBe(true);
    expect(replayMayFocus(el("BODY"), outside)).toBe(true);
    expect(replayMayFocus(el("BUTTON"), outside)).toBe(true);
    expect(replayMayFocus(el("TEXTAREA"), () => true)).toBe(true);
  });
});

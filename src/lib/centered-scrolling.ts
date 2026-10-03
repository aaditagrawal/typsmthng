/** Scroll offset that places a caret line in the vertical center of the viewport. */
export function centeredCaretScrollTop(
  lineTop: number,
  lineHeight: number,
  viewportHeight: number,
): number {
  return Math.max(0, lineTop + lineHeight / 2 - viewportHeight / 2)
}

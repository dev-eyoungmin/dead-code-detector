const IGNORE_TAG = '@dead-code-ignore';

/**
 * Checks if a specific line has an ignore comment (on the preceding line or inline).
 * @param sourceText Full file source text
 * @param lineOneBased 1-based line number of the declaration
 */
export function hasIgnoreComment(
  sourceText: string,
  lineOneBased: number
): boolean {
  const lines = sourceText.split('\n');

  // Check preceding line
  if (lineOneBased >= 2) {
    const prevLine = lines[lineOneBased - 2]?.trim();
    if (prevLine && prevLine.includes(IGNORE_TAG)) {
      return true;
    }
  }

  // Check same line (inline comment)
  if (lineOneBased >= 1) {
    const sameLine = lines[lineOneBased - 1];
    if (sameLine && sameLine.includes(IGNORE_TAG)) {
      return true;
    }
  }

  return false;
}

/**
 * Checks if the file has a file-level ignore comment on the first line.
 * @param sourceText Full file source text
 */
export function hasFileIgnoreComment(sourceText: string): boolean {
  const firstLines = sourceText.split('\n').slice(0, 3);
  return firstLines.some((line) => line.trim().includes(IGNORE_TAG));
}

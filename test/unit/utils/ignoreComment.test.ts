import { describe, it, expect } from 'vitest';
import { hasIgnoreComment, hasFileIgnoreComment } from '../../../src/utils/ignoreComment';

describe('ignoreComment utilities', () => {
  describe('hasIgnoreComment', () => {
    it('should detect ignore comment on preceding line', () => {
      const sourceText = `
// @dead-code-ignore
export function foo() {}
      `.trim();

      // Line 2 (1-based) is the function declaration
      expect(hasIgnoreComment(sourceText, 2)).toBe(true);
    });

    it('should detect inline comment with ignore tag', () => {
      const sourceText = `const x = 1; // @dead-code-ignore`;

      // Line 1 (1-based) has the inline comment
      expect(hasIgnoreComment(sourceText, 1)).toBe(true);
    });

    it('should detect block comment with ignore tag on preceding line', () => {
      const sourceText = `
/* @dead-code-ignore */
const myVariable = 42;
      `.trim();

      // Line 2 (1-based) is the variable declaration
      expect(hasIgnoreComment(sourceText, 2)).toBe(true);
    });

    it('should detect block comment with ignore tag inline', () => {
      const sourceText = `const myVariable = 42; /* @dead-code-ignore */`;

      // Line 1 (1-based) has the inline block comment
      expect(hasIgnoreComment(sourceText, 1)).toBe(true);
    });

    it('should return false when no ignore comment is present', () => {
      const sourceText = `
const a = 1;
const b = 2;
const c = 3;
      `.trim();

      // Line 2 (1-based) has no ignore comment
      expect(hasIgnoreComment(sourceText, 2)).toBe(false);
    });

    it('should handle line 1 with no preceding line but check inline comment', () => {
      const sourceText = `const x = 1; // @dead-code-ignore`;

      // Line 1 (1-based) should still detect inline comment
      expect(hasIgnoreComment(sourceText, 1)).toBe(true);
    });

    it('should return false for line 1 when no inline comment exists', () => {
      const sourceText = `const x = 1;`;

      // Line 1 (1-based) has no ignore comment
      expect(hasIgnoreComment(sourceText, 1)).toBe(false);
    });

    it('should handle multi-line scenarios with ignore on previous line', () => {
      const sourceText = `
function wrapper() {
  // @dead-code-ignore
  const unused = "test";
  return 42;
}
      `.trim();

      // Line 3 (1-based) is the const declaration
      expect(hasIgnoreComment(sourceText, 3)).toBe(true);
    });

    it('should return false when ignore comment is too far away', () => {
      const sourceText = `
// @dead-code-ignore
const a = 1;
const b = 2;
      `.trim();

      // Line 3 (1-based) is too far from the ignore comment
      expect(hasIgnoreComment(sourceText, 3)).toBe(false);
    });
  });

  describe('hasFileIgnoreComment', () => {
    it('should detect ignore comment on first line', () => {
      const sourceText = `// @dead-code-ignore
export function foo() {}
export function bar() {}`;

      expect(hasFileIgnoreComment(sourceText)).toBe(true);
    });

    it('should detect ignore comment on second line', () => {
      const sourceText = `
// @dead-code-ignore
export function foo() {}
export function bar() {}`;

      expect(hasFileIgnoreComment(sourceText)).toBe(true);
    });

    it('should detect ignore comment on third line', () => {
      const sourceText = `
// Some header comment
// @dead-code-ignore
export function foo() {}`;

      expect(hasFileIgnoreComment(sourceText)).toBe(true);
    });

    it('should return false when ignore comment is on fourth line (outside first 3)', () => {
      const sourceText = `
// Line 1
// Line 2
// Line 3
// @dead-code-ignore
export function foo() {}`;

      expect(hasFileIgnoreComment(sourceText)).toBe(false);
    });

    it('should return false for empty string', () => {
      const sourceText = '';

      expect(hasFileIgnoreComment(sourceText)).toBe(false);
    });

    it('should detect block comment with ignore tag in first three lines', () => {
      const sourceText = `/* @dead-code-ignore */
export function foo() {}`;

      expect(hasFileIgnoreComment(sourceText)).toBe(true);
    });

    it('should handle whitespace and still detect ignore tag', () => {
      const sourceText = `
   // @dead-code-ignore
export function foo() {}`;

      expect(hasFileIgnoreComment(sourceText)).toBe(true);
    });

    it('should return false when ignore comment is not in first three lines', () => {
      const sourceText = `export const a = 1;
export const b = 2;
export const c = 3;
export const d = 4;
// @dead-code-ignore
export const e = 5;`;

      expect(hasFileIgnoreComment(sourceText)).toBe(false);
    });

    it('should handle file with only newlines', () => {
      const sourceText = '\n\n\n';

      expect(hasFileIgnoreComment(sourceText)).toBe(false);
    });

    it('should detect ignore tag within longer comment', () => {
      const sourceText = `// This file contains dead code but @dead-code-ignore please
export function foo() {}`;

      expect(hasFileIgnoreComment(sourceText)).toBe(true);
    });
  });
});

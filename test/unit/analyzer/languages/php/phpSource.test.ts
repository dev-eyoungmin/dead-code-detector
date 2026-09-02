import { describe, it, expect } from 'vitest';
import { stripPhpCommentsAndStrings, findMatchingBrace } from '../../../../../src/analyzer/languages/php/phpSource';

describe('stripPhpCommentsAndStrings', () => {
  it('blanks // # /* */ comments and string bodies but keeps #[attributes] and length', () => {
    const src = `<?php\n// c1\n# c2\n#[Route('/x')]\n/* c3\n c3 */\n$a = "str with // inside";\n$b = 'it\\'s';\n$c = <<<EOT\nheredoc Foo::bar()\nEOT;\n$d = Foo::bar();`;
    const out = stripPhpCommentsAndStrings(src);
    expect(out.length).toBe(src.length);
    expect(out).not.toContain('c1');
    expect(out).not.toContain('c2');
    expect(out).not.toContain('c3');
    expect(out).toContain("#[Route(''");
    expect(out).not.toContain('/x');
    expect(out).not.toContain('str with');
    expect(out).not.toContain('heredoc');
    expect(out).toContain('$d = Foo::bar();');
  });
});

describe('findMatchingBrace', () => {
  it('returns the index of the matching close brace', () => {
    const s = 'function f() { if (x) { y(); } }';
    expect(findMatchingBrace(s, s.indexOf('{'))).toBe(s.length - 1);
  });
});

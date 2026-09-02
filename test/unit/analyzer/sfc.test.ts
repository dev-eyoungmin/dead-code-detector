import { describe, it, expect } from 'vitest';
import {
  isSfcFile,
  extractSfcScript,
  extractSfcTemplate,
  countTemplateReferences,
} from '../../../src/analyzer/sfc';

describe('isSfcFile', () => {
  it('recognises .vue and .svelte only', () => {
    expect(isSfcFile('/a/App.vue')).toBe(true);
    expect(isSfcFile('/a/App.svelte')).toBe(true);
    expect(isSfcFile('/a/App.SVELTE')).toBe(true);
    expect(isSfcFile('/a/App.ts')).toBe(false);
    expect(isSfcFile('/a/vue')).toBe(false);
  });
});

describe('extractSfcScript', () => {
  it('keeps line numbers and blanks everything outside script blocks (vue)', () => {
    const vue = `<template>\n  <Foo :x="count" />\n</template>\n<script setup lang="ts">\nimport Foo from './Foo.vue';\nconst count = 1;\n</script>\n<style>.a{}</style>\n`;
    const out = extractSfcScript(vue, '.vue');
    expect(out.split('\n').length).toBe(vue.split('\n').length);
    expect(out.split('\n')[4]).toBe("import Foo from './Foo.vue';");
    expect(out).not.toContain('<template>');
    expect(out).not.toContain('.a{}');
  });

  it('keeps both module and instance scripts (svelte)', () => {
    const sv = `<script context="module">export const load = 1;</script>\n<script>let n = 0;</script>\n<p>{n}</p>`;
    const out = extractSfcScript(sv, '.svelte');
    expect(out).toContain('export const load = 1;');
    expect(out).toContain('let n = 0;');
    expect(out).not.toContain('<p>');
  });

  it('preserves column offsets for single-line components', () => {
    const vue = `<template><p/></template><script setup>const a = 1;</script>`;
    const out = extractSfcScript(vue, '.vue');
    expect(out.length).toBe(vue.length);
    expect(out.indexOf('const a = 1;')).toBe(vue.indexOf('const a = 1;'));
  });

  it('preserves U+2028 / U+2029 line terminators when blanking', () => {
    // The TypeScript scanner counts all four terminators as line breaks, so
    // turning one into a space would shift every line reported below it.
    const vue = '<template><p>A\u2028B\u2029C</p></template>\n<script setup>\nconst a = 1;\n</script>\n';
    const out = extractSfcScript(vue, '.vue');
    const split = (text: string): string[] => text.split(/\r\n|[\n\r\u2028\u2029]/);
    expect(out.length).toBe(vue.length);
    expect(split(out).length).toBe(split(vue).length);
    expect(split(out)[4]).toBe('const a = 1;');
  });

  it('preserves a lone CR as a line terminator', () => {
    const vue = '<template><p/></template>\r<script setup>\rconst a = 1;\r</script>';
    const out = extractSfcScript(vue, '.vue');
    expect(out).toContain('\r');
    expect(out.split(/\r\n|[\n\r\u2028\u2029]/)[2]).toBe('const a = 1;');
  });

  it('returns an all-blank document when there is no script block', () => {
    const vue = `<template>\n  <p/>\n</template>\n`;
    const out = extractSfcScript(vue, '.vue');
    expect(out.trim()).toBe('');
    expect(out.split('\n').length).toBe(vue.split('\n').length);
  });
});

describe('extractSfcTemplate', () => {
  it('blanks the opening script tag too, so its attributes are not template text', () => {
    const vue = '<template><p/></template>\n<script setup lang="ts" src="./x.ts">\nconst setup = 1;\n</script>\n';
    const tpl = extractSfcTemplate(vue, '.vue');
    expect(tpl.length).toBe(vue.length);
    expect(tpl).not.toContain('<script');
    for (const attr of ['setup', 'lang', 'ts', 'src', 'module']) {
      expect(countTemplateReferences(tpl, attr)).toBe(0);
    }
  });

  it('blanks script bodies but keeps the markup and its offsets', () => {
    const vue = `<template>\n  <p>{{ a }}</p>\n</template>\n<script setup>\nconst a = 1;\n</script>\n`;
    const tpl = extractSfcTemplate(vue, '.vue');
    expect(tpl.length).toBe(vue.length);
    expect(tpl).toContain('{{ a }}');
    expect(tpl).not.toContain('const a = 1;');
  });
});

describe('countTemplateReferences', () => {
  it('matches identifiers and kebab-case component names in the template only', () => {
    const vue = `<template><my-comp :v="count" @click="onClick" /></template><script setup>const count = 1; const onClick = () => {}; const MyComp = 1; const unused = 2;</script>`;
    const tpl = extractSfcTemplate(vue, '.vue');
    expect(countTemplateReferences(tpl, 'count')).toBe(1);
    expect(countTemplateReferences(tpl, 'onClick')).toBe(1);
    expect(countTemplateReferences(tpl, 'MyComp')).toBe(1);
    expect(countTemplateReferences(tpl, 'unused')).toBe(0);
  });

  it('does not match a name that is only part of a longer identifier', () => {
    const tpl = '<template><p>{{ counter }}</p></template>';
    expect(countTemplateReferences(tpl, 'count')).toBe(0);
    expect(countTemplateReferences(tpl, 'counter')).toBe(1);
  });
});

/**
 * Single-file component (SFC) support for `.vue` and `.svelte`.
 *
 * The TypeScript compiler cannot parse an SFC document, so the script blocks are
 * lifted out of it. Everything outside a `<script>` body is replaced by spaces
 * (line terminators kept), which means the extracted text has exactly the same
 * length, line count and column offsets as the original file. Any position the
 * compiler reports therefore still points at the real location in the
 * `.vue`/`.svelte` file, and no offset mapping is needed anywhere downstream.
 *
 * Known limitations — all accepted, and all in the safe direction:
 *
 *  - Block detection is regex-based, not a real HTML parse. `SCRIPT_RE` is lazy
 *    to the first `</script>`, so a script containing the literal string
 *    `"</script>"` is truncated there, and a self-closing `<script src="./x.ts"/>`
 *    swallows the following script's opening tag. Positions of whatever *is*
 *    extracted stay correct, but symbols in a truncated block are simply not
 *    seen. A missed symbol cannot become a false positive: an export nobody
 *    collected is never reported.
 *  - `countTemplateReferences` scans all static markup, including class names,
 *    HTML comments and `<style>` blocks. `<li class="item">` therefore counts as
 *    a reference to a local named `item`, and `<a href="...">` counts as one to a
 *    single-letter local `a`. Because template hits only ever raise a reference
 *    count, the worst case is a genuinely dead symbol going unreported.
 *
 * In short: this module is a deliberately blunt instrument that suppresses
 * reports rather than a precise analysis that creates them.
 */

export type SfcExtension = '.vue' | '.svelte';

/** `<script>`, `<script setup lang="ts">`, `<script context="module">`, ... */
const SCRIPT_RE = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi;

/**
 * Every character the TypeScript scanner treats as a line terminator. Blanking
 * must preserve all four, otherwise the extracted text has fewer lines than the
 * real file and every position below the loss is reported one line too high.
 */
const LINE_TERMINATORS = '\\n\\r\\u2028\\u2029';
const NON_LINE_TERMINATOR_RE = new RegExp(`[^${LINE_TERMINATORS}]`, 'g');

/** A `<script>` block: the whole tag, and the body inside it. */
interface ScriptBlock {
  /** Start of `<script`, end just past `</script>` */
  tag: [number, number];
  /** The body between the tags */
  body: [number, number];
}

/** True for files whose scripts must be extracted before TypeScript can read them. */
export function isSfcFile(filePath: string): boolean {
  return /\.(vue|svelte)$/i.test(filePath);
}

/** Returns `.vue` / `.svelte` for an SFC path; undefined otherwise. */
export function sfcExtension(filePath: string): SfcExtension | undefined {
  const match = /\.(vue|svelte)$/i.exec(filePath);
  if (!match) {
    return undefined;
  }
  return `.${match[1].toLowerCase()}` as SfcExtension;
}

/** Locates every `<script>` block, in document order. */
function scriptBlocks(content: string): ScriptBlock[] {
  const blocks: ScriptBlock[] = [];
  SCRIPT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SCRIPT_RE.exec(content)) !== null) {
    // The body always ends right before the closing tag, so its bounds are
    // derived from the tag position rather than by searching for the body text
    // (which could also occur inside the opening tag's attributes).
    const closing = /<\/script\s*>$/i.exec(match[0]);
    if (!closing) {
      continue;
    }
    const bodyEnd = match.index + closing.index;
    blocks.push({
      tag: [match.index, match.index + match[0].length],
      body: [bodyEnd - match[1].length, bodyEnd],
    });
  }
  return blocks;
}

/** Replaces every character except line terminators with a space. */
function blank(text: string): string {
  return text.replace(NON_LINE_TERMINATOR_RE, ' ');
}

/** Keeps only the given ranges; blanks the rest, preserving line terminators. */
function blankExcept(content: string, keep: Array<[number, number]>): string {
  let out = '';
  let cursor = 0;
  for (const [start, end] of keep) {
    out += blank(content.slice(cursor, start));
    out += content.slice(start, end);
    cursor = end;
  }
  return out + blank(content.slice(cursor));
}

/**
 * Returns the SFC's script bodies with everything else blanked out.
 * Same length, same line count and same column offsets as `content`.
 */
export function extractSfcScript(content: string, _ext: SfcExtension): string {
  return blankExcept(
    content,
    scriptBlocks(content).map((block) => block.body)
  );
}

/**
 * The inverse of extractSfcScript: whole `<script>` blocks are blanked, markup is
 * kept. Used to look for template references to script-level symbols.
 *
 * The opening tag is blanked along with the body: otherwise `<script setup
 * lang="ts">` would count as a template reference to locals named `setup`,
 * `lang`, `ts`, `module` or `src` and silently suppress their reports.
 */
export function extractSfcTemplate(content: string, _ext: SfcExtension): string {
  let out = content;
  for (const block of scriptBlocks(content).reverse()) {
    const [start, end] = block.tag;
    out = out.slice(0, start) + blank(out.slice(start, end)) + out.slice(end);
  }
  return out;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `MyComp` -> `my-comp`, the kebab-case spelling templates may use. */
function toKebabCase(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * Counts template references to `name`, matching both the identifier itself and
 * its kebab-case component spelling. Deliberately conservative: it only ever
 * raises a reference count, so it can suppress a report but never create one.
 * See the module docstring for what else this counts as a "reference".
 */
export function countTemplateReferences(template: string, name: string): number {
  if (name.length === 0) {
    return 0;
  }
  const kebab = toKebabCase(name);
  const alternatives =
    kebab === name ? escapeRegex(name) : `${escapeRegex(name)}|${escapeRegex(kebab)}`;
  const re = new RegExp(`(?<![\\w$-])(?:${alternatives})(?![\\w$-])`, 'g');
  return (template.match(re) ?? []).length;
}

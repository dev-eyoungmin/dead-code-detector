import * as path from 'path';
import type { DependencyGraph } from '../types';
import { makeExportKey } from './exportKey';
import { readSource } from './sourceCache';
import { detectLanguage } from './languages';

/**
 * Placeholder "user" recorded on an export that is referenced by name from
 * another file of the same language. It is deliberately not a file path so
 * that reachability filtering can recognise and keep it.
 */
export const MEMBER_USAGE_SENTINEL = '<member-usage>';

/** Export kinds that can be reached through member access rather than an import. */
const MEMBER_KINDS = new Set(['method', 'constant', 'variable']);

/** `$obj->name`, `Foo::name`, `obj.name` */
const MEMBER_TOKEN = /(?:->|::|\.)\s*([A-Za-z_]\w*)/g;
/** `[Foo::class, 'index']`, `[$this, 'handle']` */
const PHP_CALLABLE_ARRAY = /\[\s*(?:[\w\\]+::class|\$this|self::class|static::class)\s*,\s*['"]([A-Za-z_]\w*)['"]\s*\]/g;
/** `'Controller@index'`, `'App\\Http\\Controllers\\Controller@index'` */
const PHP_AT_STRING = /['"][A-Za-z_\\][\w\\]*@([A-Za-z_]\w*)['"]/g;
/**
 * `Route::resource('posts', PostController::class)` / `Route::apiResource(...)` and
 * their plural array forms. A resource route maps the seven RESTful actions onto the
 * controller by convention and names none of them, so nothing in the sources ever
 * mentions `show`/`store`/`edit`/`destroy`.
 *
 * This is preferred over adding the seven names to `LARAVEL_CONVENTIONAL_EXPORTS`:
 * the conventional list would suppress those names in *every* Laravel file
 * unconditionally (a genuinely dead `show()` on a service could never be reported
 * again), whereas this rule only contributes them when the project actually
 * declares a resource route.
 */
const PHP_RESOURCE_ROUTE = /\bRoute\s*::\s*(?:api)?[Rr]esources?\s*\(/;
/** The actions Laravel's resource router maps (apiResource maps a subset). */
const PHP_RESOURCE_ACTIONS = ['index', 'create', 'store', 'show', 'edit', 'update', 'destroy'];

/** Callback helpers that take a function name as a string literal argument. */
const PHP_HOOK_CALL = /\b(?:add_action|add_filter|register_activation_hook|register_deactivation_hook|call_user_func|call_user_func_array|array_map|usort|uasort|array_filter|array_walk)\s*\(([^)]*)\)/g;
/** A bare quoted identifier, used to scan the argument list of a hook call. */
const QUOTED_NAME = /['"]([A-Za-z_]\w*)['"]/g;

/**
 * Matches, in priority order, a string literal (double / single / backtick),
 * a block comment, a `//` line comment, or a `#` line comment that is not a
 * PHP 8 attribute (`#[Attr]`). String literals come first so that a `#` or a
 * `//` inside a literal (e.g. `$color = '#fff'`) cannot start a comment.
 */
const SOURCE_NOISE = /("(?:[^"\\]|\\[\s\S])*")|('(?:[^'\\]|\\[\s\S])*')|(`(?:[^`\\]|\\[\s\S])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*|(#(?!\[)[^\n]*)/g;

/**
 * Removes comments from source text in a single left-to-right pass, so a
 * comment character inside a string literal is never mistaken for a comment
 * and vice versa.
 *
 * @param keepStrings when true string literals are preserved verbatim (PHP
 *   callable detection reads names out of them); otherwise their bodies are
 *   emptied so identifiers inside them are not counted as references.
 *
 * Note: `#` line comments are only stripped for Python and PHP, where `#`
 * starts a comment. Elsewhere (e.g. C#-style directives) they are left alone.
 */
export function stripSourceNoise(
  content: string,
  filePath: string,
  keepStrings: boolean
): string {
  const hashComments = /\.(py|php)$/i.test(filePath);

  return content.replace(
    SOURCE_NOISE,
    (match, dq: string | undefined, sq: string | undefined, bt: string | undefined, hash: string | undefined) => {
      const isString = dq !== undefined || sq !== undefined || bt !== undefined;
      if (isString) {
        if (keepStrings) return match;
        if (dq !== undefined) return '""';
        if (sq !== undefined) return "''";
        return '``';
      }
      // A `#` run is only a comment in Python/PHP; keep it verbatim elsewhere.
      if (hash !== undefined && !hashComments) return match;
      return '';
    }
  );
}

function addMatches(regex: RegExp, source: string, out: Set<string>): void {
  regex.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    out.add(match[1]);
  }
}

function collectTokens(filePath: string, rawSource: string): Set<string> {
  const tokens = new Set<string>();
  // Comments are dropped so that a mention in prose ("// calls x.capitalize()")
  // does not keep a member alive. String literals are kept: the PHP callable
  // forms below read the member name out of them.
  const source = stripSourceNoise(rawSource, filePath, true);
  addMatches(MEMBER_TOKEN, source, tokens);

  if (path.extname(filePath).toLowerCase() === '.php') {
    addMatches(PHP_CALLABLE_ARRAY, source, tokens);
    addMatches(PHP_AT_STRING, source, tokens);
    // Every string literal in a callback helper's argument list is a candidate
    // callback name; scanning them all also covers `add_action('init', 'hook')`.
    PHP_HOOK_CALL.lastIndex = 0;
    let call: RegExpExecArray | null;
    while ((call = PHP_HOOK_CALL.exec(source)) !== null) {
      addMatches(QUOTED_NAME, call[1], tokens);
    }
    if (PHP_RESOURCE_ROUTE.test(source)) {
      for (const action of PHP_RESOURCE_ACTIONS) {
        tokens.add(action);
      }
    }
  }

  return tokens;
}

/**
 * Marks member-like exports (methods, constants, fields) of non-TypeScript files
 * as used when another file of the same language references the name.
 *
 * Languages such as Java, PHP, Python and Dart reach members through the
 * receiver rather than through an import, so import edges alone under-report
 * usage. TypeScript is excluded because its exports are tracked precisely.
 */
export function applyMemberNameUsage(graph: DependencyGraph): void {
  const tokensByFile = new Map<string, Set<string>>();
  const filesByLang = new Map<string, string[]>();

  for (const filePath of graph.files.keys()) {
    const lang = detectLanguage(filePath);
    if (!lang || lang === 'typescript') {
      continue;
    }
    let langFiles = filesByLang.get(lang);
    if (!langFiles) {
      langFiles = [];
      filesByLang.set(lang, langFiles);
    }
    langFiles.push(filePath);

    const source = readSource(filePath);
    if (source === null) {
      continue;
    }
    tokensByFile.set(filePath, collectTokens(filePath, source));
  }

  for (const files of filesByLang.values()) {
    // token -> number of files of this language that reference it
    const union = new Map<string, number>();
    for (const file of files) {
      for (const token of tokensByFile.get(file) ?? []) {
        union.set(token, (union.get(token) ?? 0) + 1);
      }
    }

    for (const file of files) {
      const own = tokensByFile.get(file) ?? new Set<string>();
      const node = graph.files.get(file);
      if (!node) {
        continue;
      }
      for (const exp of node.exports) {
        if (!MEMBER_KINDS.has(exp.kind)) {
          continue;
        }
        const usages = graph.exportUsages.get(makeExportKey(file, exp.name));
        if (!usages || usages.size > 0) {
          continue;
        }
        const total = union.get(exp.name) ?? 0;
        const elsewhere = total - (own.has(exp.name) ? 1 : 0);
        if (elsewhere > 0) {
          usages.add(MEMBER_USAGE_SENTINEL);
        }
      }
    }
  }
}

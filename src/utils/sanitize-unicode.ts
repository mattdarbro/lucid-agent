/**
 * Unicode sanitization helpers.
 *
 * JavaScript strings are UTF-16, so an astral character (e.g. most emoji) is
 * stored as a *surrogate pair*: a high surrogate (U+D800–U+DBFF) followed by a
 * low surrogate (U+DC00–U+DFFF). When text is truncated by character/code-unit
 * count (`.slice(0, n)`, `.substring(0, n)`), the cut can land between the two
 * halves and leave a *lone* surrogate behind.
 *
 * `JSON.stringify` happily serializes a lone surrogate as e.g. `\uD83D`, but
 * stricter JSON parsers — including the one behind the Anthropic API — reject
 * it with `"no low surrogate in string"` (HTTP 400, invalid_request_error).
 * That turns a stray emoji in the prompt/history into a hard, non-retryable
 * chat failure.
 *
 * `stripLoneSurrogates` removes any unpaired surrogate code units while leaving
 * valid pairs (and all other text) untouched.
 */

// A high surrogate NOT followed by a low surrogate, OR a low surrogate NOT
// preceded by a high surrogate. Valid pairs match neither branch.
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Remove unpaired UTF-16 surrogate code units from a string so the result is
 * always well-formed Unicode and safe to send as JSON.
 */
export function stripLoneSurrogates(input: string): string {
  if (!input) return input;
  // Fast path: most strings have no surrogates at all.
  if (!/[\uD800-\uDFFF]/.test(input)) return input;
  return input.replace(LONE_SURROGATE, '');
}

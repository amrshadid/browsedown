/**
 * Escaping for the page templates. Everything that reaches a template from a
 * file name, a path or a heading is untrusted: a file can be named
 * `"><script>alert(1)</script>.md`.
 */

const ENTITIES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes text for element content and for quoted attribute values. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ENTITIES[char] ?? char);
}

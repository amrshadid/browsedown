import { describe, expect, it } from 'vitest';

import {
  checkDecodedPath,
  checkScopedPath,
  type PathFlavor,
  type ScopeRejection,
} from '../../src/core';

const FLAVORS: readonly PathFlavor[] = ['posix', 'windows'];

describe('checkScopedPath: the spelling half of the scope guard', () => {
  describe('accepts ordinary paths', () => {
    it.each([
      ['README.md', ['README.md']],
      ['docs/a.md', ['docs', 'a.md']],
      ['docs/My%20Notes/caf%C3%A9%20%C3%A9.md', ['docs', 'My Notes', 'café é.md']],
      ['docs/a%23b.md', ['docs', 'a#b.md']],
      ['img/logo.png', ['img', 'logo.png']],
      // Dots inside names are fine; only whole `.`/`..` segments climb.
      ['..notes/a.md', ['..notes', 'a.md']],
      ['a..b/c.md', ['a..b', 'c.md']],
      ['.hidden/a.md', ['.hidden', 'a.md']],
      // Contain a device name but aren't one.
      ['conference/console.md', ['conference', 'console.md']],
    ])('%s', (encoded, segments) => {
      for (const flavor of FLAVORS) {
        const result = checkScopedPath(encoded, flavor);
        expect(result).toEqual({ ok: true, value: { segments, path: segments.join('/') } });
      }
    });
  });

  describe('rejects hostile paths on every platform', () => {
    const cases: [string, ScopeRejection][] = [
      // Traversal, plain and encoded once.
      ['..', 'dot-segment'],
      ['../secret.md', 'dot-segment'],
      ['docs/../../secret.md', 'dot-segment'],
      ['%2e%2e/secret.md', 'dot-segment'],
      ['%2E%2E%2Fsecret.md', 'dot-segment'],
      ['docs/%2e%2e%2f%2e%2e%2fsecret.md', 'dot-segment'],
      ['.', 'dot-segment'],
      ['./a.md', 'dot-segment'],
      ['docs/./a.md', 'dot-segment'],
      // Absolute and UNC-style prefixes become empty segments.
      ['/etc/passwd', 'empty-segment'],
      ['%2Fetc%2Fpasswd', 'empty-segment'],
      ['//server/share/a.md', 'empty-segment'],
      ['docs//a.md', 'empty-segment'],
      ['docs/', 'empty-segment'],
      ['', 'empty-segment'],
      // NUL and other control characters.
      ['a.md%00.png', 'control-character'],
      ['docs/%0Aa.md', 'control-character'],
      ['docs/a%7F.md', 'control-character'],
      // Malformed percent-encoding is rejected, not passed through.
      ['%', 'malformed-encoding'],
      ['%E0%A4%A', 'malformed-encoding'],
      ['%C0%AE%C0%AE/secret.md', 'malformed-encoding'], // overlong UTF-8 for `..`
    ];
    it.each(cases)('%s → %s', (encoded, reason) => {
      for (const flavor of FLAVORS) {
        expect(checkScopedPath(encoded, flavor)).toEqual({ ok: false, reason });
      }
    });
  });

  describe('decodes exactly once', () => {
    it.each([
      ['%252e%252e/secret.md', ['%2e%2e', 'secret.md']],
      ['%252e%252e%252fsecret.md', ['%2e%2e%2fsecret.md']],
      ['%255c', ['%5c']],
    ])('%s stays a literal name', (encoded, segments) => {
      for (const flavor of FLAVORS) {
        expect(checkScopedPath(encoded, flavor)).toEqual({
          ok: true,
          value: { segments, path: segments.join('/') },
        });
      }
    });
  });

  describe('Windows-only rules', () => {
    const windowsOnly: [string, ScopeRejection][] = [
      // Backslashes are a separator on Windows.
      ['..\\secret.md', 'backslash'],
      ['%5C%5Cserver%5Cshare', 'backslash'],
      ['docs%5C..%5C..%5Csecret.md', 'backslash'],
      // Drive letters and NTFS alternate data streams.
      ['C:', 'colon'],
      ['C:/Windows/win.ini', 'colon'],
      ['c%3A%2Fwindows', 'colon'],
      ['docs/a.md:secret', 'colon'],
      ['docs/a.md::$DATA', 'colon'],
      // A legal name on macOS and Linux, such as a timestamped note.
      ['notes/2026-01-01T10%3A00.md', 'colon'],
      ['CON', 'windows-reserved-name'],
      ['con.md', 'windows-reserved-name'],
      ['docs/NUL.txt', 'windows-reserved-name'],
      ['aux.tar.gz', 'windows-reserved-name'],
      ['COM1', 'windows-reserved-name'],
      ['lpt9.md', 'windows-reserved-name'],
      ['COM%C2%B9', 'windows-reserved-name'], // COM¹
      ['CON%20.md', 'windows-reserved-name'], // `CON .md`
      ['prn%20', 'windows-trailing-dot-or-space'],
      ['docs/a.md.', 'windows-trailing-dot-or-space'],
      ['..%20/secret.md', 'windows-trailing-dot-or-space'], // `.. ` would act as `..`
      ['docs./a.md', 'windows-trailing-dot-or-space'],
      ['...', 'windows-trailing-dot-or-space'],
      ['a%3Fb.md', 'windows-forbidden-character'],
      ['a*.md', 'windows-forbidden-character'],
      ['a%3Cb%3E.md', 'windows-forbidden-character'],
      ['a%22b.md', 'windows-forbidden-character'],
      ['a%7Cb.md', 'windows-forbidden-character'],
    ];
    it.each(windowsOnly)('%s → %s on Windows, allowed on POSIX', (encoded, reason) => {
      expect(checkScopedPath(encoded, 'windows')).toEqual({ ok: false, reason });
      expect(checkScopedPath(encoded, 'posix').ok).toBe(true);
    });

    it.each(['CONSOLE.md', 'com10.md', 'nul-notes/a.md', 'lpt.md'])(
      '%s is not a device name',
      (encoded) => {
        expect(checkScopedPath(encoded, 'windows').ok).toBe(true);
      },
    );
  });
});

describe('checkDecodedPath', () => {
  it('applies the same rules without decoding', () => {
    expect(checkDecodedPath('docs/My Notes/a.md', 'posix').ok).toBe(true);
    expect(checkDecodedPath('docs/../a.md', 'posix')).toEqual({
      ok: false,
      reason: 'dot-segment',
    });
  });

  it('never decodes a second time', () => {
    expect(checkDecodedPath('%2e%2e/a.md', 'posix')).toEqual({
      ok: true,
      value: { segments: ['%2e%2e', 'a.md'], path: '%2e%2e/a.md' },
    });
  });
});

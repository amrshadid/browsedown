import { describe, expect, it } from 'vitest';

import { IgnoreRules } from '../../src/core';

describe('IgnoreRules', () => {
  it('applies each .gitignore relative to its own folder', () => {
    const rules = new IgnoreRules();
    rules.add('', 'drafts/\n*.tmp\n');
    rules.add('sub', 'local.md\n');
    expect(rules.isIgnored('drafts', true)).toBe(true);
    expect(rules.isIgnored('a.tmp', false)).toBe(true);
    expect(rules.isIgnored('sub/local.md', false)).toBe(true);
    expect(rules.isIgnored('local.md', false)).toBe(false);
    expect(rules.isIgnored('sub/keep.md', false)).toBe(false);
  });

  it('lets a deeper negation re-include a file', () => {
    const rules = new IgnoreRules();
    rules.add('', '*.md\n');
    rules.add('docs', '!keep.md\n');
    expect(rules.isIgnored('docs/keep.md', false)).toBe(false);
    expect(rules.isIgnored('docs/other.md', false)).toBe(true);
  });

  it('matches folder-only rules only for folders', () => {
    const rules = new IgnoreRules();
    rules.add('', 'build/\n');
    expect(rules.isIgnored('build', true)).toBe(true);
    expect(rules.isIgnored('build', false)).toBe(false);
  });

  it('ignores nothing without rules', () => {
    expect(new IgnoreRules().isIgnored('a/b.md', false)).toBe(false);
  });
});

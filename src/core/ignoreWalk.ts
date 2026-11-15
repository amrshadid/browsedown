/**
 * `.gitignore` rules for the folder walker, used when git can't list a folder
 * (it's ignored by git, outside git, or the workspace isn't trusted). Only the
 * `.gitignore` files inside the opened folder apply: the folder is the boundary.
 *
 * As in git, each file applies relative to its own folder and deeper files win
 * (a child `!rule` can re-include). Nothing under an ignored folder can come back,
 * which holds because the walker never enters ignored folders.
 * https://github.com/kaelzhang/node-ignore
 */
import ignore, { type Ignore } from 'ignore';

/** Ignore rules collected while walking, keyed by folder (scope-relative, `''` = root). */
export class IgnoreRules {
  private readonly matchers = new Map<string, Ignore>();

  /** Adds the contents of `<folder>/.gitignore`. */
  add(folder: string, gitignore: string): void {
    this.matchers.set(folder, ignore().add(gitignore));
  }

  /** Whether `path` (scope-relative, `/`-separated) is ignored by its ancestors' rules. */
  isIgnored(path: string, isDirectory: boolean): boolean {
    const segments = path.split('/');
    let ignored = false;
    for (let depth = 0; depth < segments.length; depth++) {
      const folder = segments.slice(0, depth).join('/');
      const matcher = this.matchers.get(folder);
      if (matcher === undefined) {
        continue;
      }
      const relative = segments.slice(depth).join('/') + (isDirectory ? '/' : '');
      const result = matcher.test(relative);
      if (result.ignored) {
        ignored = true;
      } else if (result.unignored) {
        ignored = false;
      }
    }
    return ignored;
  }
}

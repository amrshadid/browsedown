/**
 * Paths the reader hid in Browsedown (ADR 0009): not listed and not served. Kept per
 * workspace in VS Code's storage as real paths; nothing goes into the repository.
 *
 * A path is hidden when it is a hidden path or inside one, compared the way the
 * scope guard compares (`isStrictlyInside`): case-insensitively on Windows, exactly
 * elsewhere. Callers pass real paths, so a symlink into a hidden folder is hidden too.
 */
import * as path from 'node:path';

import { isStrictlyInside } from './scopedFile';

/** The slice of `vscode.Memento` this needs, so tests don't need VS Code. */
export interface HiddenState {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): Thenable<void>;
}

const KEY = 'browsedown.hidden';

export class HiddenPaths {
  private paths: string[];
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly state: HiddenState,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {
    const stored: unknown = state.get<unknown>(KEY, []);
    this.paths = Array.isArray(stored)
      ? stored.filter((p): p is string => typeof p === 'string')
      : [];
  }

  /** The hidden real paths, in the order they were hidden. */
  list(): readonly string[] {
    return this.paths;
  }

  /** Whether `real` (a real path) is hidden, or inside a hidden folder. */
  isHidden(real: string): boolean {
    return this.paths.some((hidden) => this.covers(hidden, real));
  }

  /** The hidden paths that make `real` hidden (itself, or folders above it). */
  covering(real: string): string[] {
    return this.paths.filter((hidden) => this.covers(hidden, real));
  }

  async hide(reals: readonly string[]): Promise<void> {
    const next = [...this.paths];
    for (const real of reals) {
      if (!next.some((p) => this.same(p, real))) {
        next.push(real); // Also drops repeats within one call (a multi-select).
      }
    }
    if (next.length > this.paths.length) {
      await this.save(next);
    }
  }

  async unhide(reals: readonly string[]): Promise<void> {
    const kept = this.paths.filter((p) => !reals.some((real) => this.same(p, real)));
    if (kept.length !== this.paths.length) {
      await this.save(kept);
    }
  }

  /** Calls `listener` after every change. */
  onDidChange(listener: () => void): { dispose: () => void } {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  private async save(paths: string[]): Promise<void> {
    this.paths = paths;
    await this.state.update(KEY, paths);
    for (const listener of this.listeners) {
      listener();
    }
  }

  private covers(hidden: string, real: string): boolean {
    return this.same(hidden, real) || isStrictlyInside(hidden, real, this.platform);
  }

  private same(a: string, b: string): boolean {
    const api = this.platform === 'win32' ? path.win32 : path.posix;
    return api.relative(a, b) === '';
  }
}

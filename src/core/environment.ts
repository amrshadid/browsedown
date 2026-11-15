/** The two `vscode.env` facts the desktop-only rule needs, without depending on VS Code. */
export interface HostEnvironment {
  /** `vscode.env.remoteName`: `undefined` in a local window, e.g. `'wsl'` otherwise. */
  readonly remoteName: string | undefined;
  /** True when `vscode.env.uiKind === UIKind.Web`. */
  readonly isWeb: boolean;
}

export const UNSUPPORTED_ENVIRONMENT_MESSAGE =
  'Browsedown currently works in local desktop windows only.';

/**
 * True only in a local desktop window. Remote and web windows tunnel localhost
 * through a different host and port, which the server's Host check refuses, and
 * a forwarded port can be made public.
 */
export function isSupportedEnvironment(env: HostEnvironment): boolean {
  return env.remoteName === undefined && !env.isWeb;
}

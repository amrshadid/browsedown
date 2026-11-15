// Integration tests run inside a separately downloaded VS Code build with an
// isolated user-data and extensions directory, so they never touch your
// installed editor, settings or other open projects.
import { defineConfig } from '@vscode/test-cli';

export default defineConfig([
  {
    label: 'main',
    files: 'out/test/integration/suite/**/*.test.js',
    workspaceFolder: './test/fixtures/workspace',
    // Trusted, so discovery takes the git path deterministically (the untrusted walk
    // is covered by the unit tests).
    launchArgs: ['--disable-extensions', '--disable-workspace-trust'],
    mocha: { ui: 'tdd', timeout: 20000 },
  },
]);

import * as assert from 'node:assert/strict';

import * as vscode from 'vscode';

const EXTENSION_ID = 'browsedown.browsedown';

suite('activation', () => {
  test('activates and registers the commands', async () => {
    // No activation events are declared: VS Code activates on the first command.
    // Activate explicitly so the assertion doesn't depend on that timing.
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `${EXTENSION_ID} is not installed in the test instance`);
    await extension.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('browsedown.openInBrowser'));
    assert.ok(commands.includes('browsedown.stopAll'));
  });
});

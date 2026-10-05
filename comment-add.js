// A "+" in a comment thread's title bar, right before VS Code's own ^ (collapse): starts a
// new comment next to this thread, without hunting for the gutter's add-comment hint — which
// on a line that already has a thread is hidden under that thread's glyph.
//
// Not on the thread's own last line: VS Code keeps one thread widget per gutter line (the
// line its range ends on), and `workbench.action.addComment` there just toggles the existing
// one — measured, the click collapsed the thread. So the new comment goes on the thread's
// FIRST line; a one-line thread has no free line of its own, and gets a status message.
//
// The menu (`comments/commentThread/title`, group `2_add`) sorts after the GitHub PR
// extension's refresh (`0_refresh`) and collapse-all (`1_collapse`); the ^ is appended by
// the widget itself, always last. The argument is the thread object of whichever extension
// owns it — the extension host revives it for any command, so `uri` and `range` are there.

const vscode = require('vscode');

async function addCommentOnThreadLine(thread) {
  if (!thread || !thread.uri || !thread.range) return;
  const uri = thread.uri.toString();
  const active = vscode.window.activeTextEditor;
  const editor = active && active.document.uri.toString() === uri
    ? active
    : vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === uri);
  if (!editor) return;
  if (thread.range.start.line === thread.range.end.line) {
    vscode.window.setStatusBarMessage('One comment thread per line in VS Code — reply in this one', 4000);
    return;
  }
  const line = thread.range.start.line;
  editor.selection = new vscode.Selection(line, 0, line, 0);
  await vscode.commands.executeCommand('workbench.action.addComment');
}

function register(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('victor-vsc.addCommentOnThreadLine', addCommentOnThreadLine)
  );
}

module.exports = { register };

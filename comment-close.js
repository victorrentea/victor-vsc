// An × in a comment thread's title bar, at the far right where VS Code's ^ (collapse) was:
// closes the thread's box. The ^ did the same but didn't read as "close";
// vscode-patch/workbench.css hides it, so there's one way out and it looks like one.
//
// The menu (`comments/commentThread/title`, group `2_close`) sorts after the GitHub PR
// extension's refresh (`0_refresh`) and collapse-all (`1_collapse`). The argument is the
// thread object of whichever extension owns it — every extension shares one extension host,
// which hands any command the live object, so collapsing it is the owner's own state change.

const vscode = require('vscode');

function register(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('victor-vsc.closeCommentThread', (thread) => {
      if (thread && 'collapsibleState' in thread) {
        thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
      }
    })
  );
}

module.exports = { register };

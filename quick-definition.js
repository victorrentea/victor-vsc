// ⌘-click = IntelliJ's Quick Definition: the whole definition in a floating hover you can
// scroll and click into, instead of jumping to the file. The wheel click still jumps.
//
// The click itself is caught in the workbench, not here — an extension never sees mouse
// buttons or modifiers. `vscode-patch/apply.sh` (3i) rewires `gotoDefinition` in the bundle:
// a real ⌘-click runs `victor-vsc.quickDefinition` with the caret already on the clicked
// word; the wheel click (replayed by `vscode-patch/workbench.js` under a flag) navigates.
//
// Why a hover and not the two built-ins:
// - ⌘-hover's own preview shows the provider's `targetRange`. The Cucumber language server
//   returns just the `@Then("…")` line, so a step showed its annotation and nothing else.
// - Peek Definition opens inline and pushes the lines below it down.
// An extension can only put a floating box over the editor through a HoverProvider, so the
// command computes the content, parks it, and asks for `editor.action.showHover` at the caret.
// The provider answers only for that parked position: ordinary mouse-over stays as it was.

const vscode = require('vscode');

/** Longer than this and the hover stops being a glance; it scrolls, but has to end. */
const MAX_LINES = 150;
/** How far below the definition line a `{` may open the body (annotations, wrapped params). */
const BRACE_LOOKAHEAD = 12;

const OPEN = 'victor-vsc.quickDefinition.open';

let pending = null;   // { uri, line, hover }

/** 0-based [start, end] of the definition that starts at `start`: a brace block when one
 *  opens soon after, else the indented block under it (Python, YAML…), else the line alone. */
function definitionSpan(lines, start) {
  const opens = lines.slice(start, start + BRACE_LOOKAHEAD).findIndex((l) => l.includes('{'));
  if (opens >= 0) {
    let depth = 0;
    for (let i = start; i < lines.length && i < start + MAX_LINES; i++) {
      for (const ch of stripStrings(lines[i])) {
        if (ch === '{') depth++;
        else if (ch === '}' && --depth === 0) return [start, i];
      }
    }
    return [start, Math.min(lines.length, start + MAX_LINES) - 1];
  }
  const indent = (l) => l.length - l.trimStart().length;
  const base = indent(lines[start]);
  let end = start;
  for (let i = start + 1; i < lines.length && i < start + MAX_LINES; i++) {
    if (!lines[i].trim()) continue;
    if (indent(lines[i]) <= base) break;
    end = i;
  }
  return [start, end];
}

/** Braces inside string literals ("{int}" in a Cucumber expression) don't count. */
function stripStrings(line) {
  return line.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, '""');
}

/** Annotations / decorators right above the definition belong to it. */
function withLeadingAnnotations(lines, start) {
  while (start > 0 && /^\s*@/.test(lines[start - 1])) start--;
  return start;
}

function dedent(lines) {
  const widths = lines.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length);
  const cut = widths.length ? Math.min(...widths) : 0;
  return lines.map((l) => l.slice(cut));
}

async function quickDefinition() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const at = editor.selection.active;
  const found = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', editor.document.uri, at);
  const first = found && found[0];
  if (!first) return;
  const uri = first.targetUri || first.uri;
  const range = first.targetSelectionRange || first.targetRange || first.range;

  const doc = await vscode.workspace.openTextDocument(uri);
  const lines = doc.getText().split(/\r?\n/);
  const [from, to] = definitionSpan(lines, range.start.line);
  const start = withLeadingAnnotations(lines, from);
  const code = dedent(lines.slice(start, to + 1)).join('\n');

  const where = `${vscode.workspace.asRelativePath(uri)}:${range.start.line + 1}`;
  // Our own command id, not `vscode.open` directly: the link's `data-href` is what
  // vscode-patch/workbench.css keys on to give only this hover unwrapped, two-axis scroll.
  const open = `command:${OPEN}?${encodeURIComponent(JSON.stringify([uri.toString(), range.start.line]))}`;
  const md = new vscode.MarkdownString(`[${where}](${open})\n`);
  md.isTrusted = { enabledCommands: [OPEN] };
  md.appendCodeblock(code, doc.languageId);

  pending = { uri: editor.document.uri.toString(), line: at.line, hover: new vscode.Hover(md) };
  // Not before this command returns: until then the ⌘-hover link decoration is still on the
  // word, its hover message (VS Code's own short preview) would join ours as a second copy,
  // and the renderer removes it only once `gotoDefinition` — which awaits us — settles.
  setTimeout(async () => {
    await vscode.commands.executeCommand('editor.action.showHover', { focus: 'noAutoFocus' });
    setTimeout(() => { pending = null; }, 1500);
  }, 50);
}

function register(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('victor-vsc.quickDefinition', quickDefinition),
    vscode.commands.registerCommand(OPEN, (uri, line) => {
      const at = new vscode.Range(line, 0, line, 0);
      return vscode.window.showTextDocument(vscode.Uri.parse(uri), { selection: at });
    }),
    vscode.languages.registerHoverProvider({ scheme: 'file' }, {
      provideHover(document, position) {
        if (pending && pending.uri === document.uri.toString() && pending.line === position.line) {
          return pending.hover;
        }
        return undefined;
      }
    })
  );
}

module.exports = { register, definitionSpan };

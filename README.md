# victor-vsc

Personal VS Code extension that bends VS Code towards IntelliJ IDEA and drops in
a few things I keep wanting. Not on the Marketplace — built to a `.vsix` and
installed by hand.

## What's in it

| | |
|---|---|
| **expui icon theme** | `intellij-icon-theme.json` + `icons/*.svg`, the file icons from IntelliJ's New UI |
| **IntelliJ colours** | `contributes.configurationDefaults` for the *IntelliJ IDEA Islands Light/Dark* themes — chrome grey stays on the frame, content (tree, editor, terminal) shares one background. Rationale: [COLORS.md](COLORS.md) |
| **Status bar** | breadcrumb moved to the footer like IntelliJ, own problems counter on the right, cog that opens the Command Palette |
| **Title bar** | 20% shorter (35 → 28px, patched in the bundle), the ← → navigation buttons are off (`workbench.navigationControl.enabled: false`), and a tools button is drawn as the leftmost section of the agent badge by `vscode-patch/workbench.js`. It is a proxy: the click is forwarded to the hidden `victorrentea.victor-vsc.tools` status bar entry, because a node moved into the command center loses its clicks to the action bar around it |
| **Markdown preview** | Ctrl+wheel zoom, line numbers |
| **Claude terminal profile** | a `Claude` entry in the terminal dropdown, with a flower icon |
| **Middle click = ⌘ click** | pressing the scroll wheel over code replays the DOM events of a real ⌘ click, i.e. Go to Definition. VS Code has no setting for the middle button and keybindings cannot bind mouse buttons; the editor reads the modifier off the event, so a replayed event with `metaKey` is enough (`vscode-patch/workbench.js`) |
| **Token counter icon** | the `gpt-token-counter-live` status bar text is templated here, so the count leads with `$(victor-coins)` — a second glyph in the icon font |
| **No soft wrap in Markdown** | VS Code's own built-ins force `editor.wordWrap: "on"` for `[markdown]` (markdown-language-features) and for `[prompt]`/`[instructions]`/`[chatagent]`/`[skill]` (prompt-basics), so ⌃` only turns wrapping off for the current editor and every newly opened file is wrapped again. This extension contributes `"off"` for the same five language ids |

## The flower

VS Code's terminal-profile dropdown renders its icon from a *registered icon id*
— a codicon, or one contributed through `contributes.icons`. It will not take an
SVG file. There is no flower among the ~750 codicons, so `icons/victor-icons.woff`
is a one-glyph font built by [`build-flower-font.py`](build-flower-font.py): six
elliptical petals winding clockwise plus a heart winding the other way, so the
non-zero fill rule punches the hole in the middle. It is drawn on codicon's own
grid (upem 300, ascent 300, glyph box 0..282) so it lines up with the built-in
icons.

Rebuild it with:

```sh
python3 build-flower-font.py icons/victor-icons.woff /tmp/proof.svg
```

## Build & install

```sh
npx --yes @vscode/vsce package
code --install-extension victor-vsc-<version>.vsix --force
```

Then reload the window.

## Credit

The `icons/ft-*.svg` files and the symbol colours come from
[intellij-community](https://github.com/JetBrains/intellij-community)
(Apache-2.0). Everything else here is public domain (Unlicense).

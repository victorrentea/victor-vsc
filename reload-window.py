#!/usr/bin/env python3
"""Reload VS Code windows, so a freshly installed build of this extension takes effect.

Each window's extension host publishes {port, token} under ~/.walkie-talkie/ide/
(see relay-terminal.js). We ask each one who it is (/ping) and then tell it to
reload (/reload).

By default *every* window is reloaded: when this runs from a terminal no VS Code
window is focused, so "the active one" is not observable from here — and the new
build has to land in every extension host anyway.

Usage:
  ./reload-window.py                # all windows
  ./reload-window.py --folder NAME  # only windows with that workspace folder
  ./reload-window.py --focused      # only a window that currently has OS focus
"""
import json, sys, urllib.request, pathlib

REGISTRY = pathlib.Path.home() / ".walkie-talkie" / "ide"


def call(port, token, path, method="GET"):
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}", method=method,
        headers={"x-relay-token": token})
    with urllib.request.urlopen(req, timeout=3) as r:
        return json.load(r)


def main(argv):
    want_folder = argv[argv.index("--folder") + 1] if "--folder" in argv else None
    only_focused = "--focused" in argv

    done = []
    for f in sorted(REGISTRY.glob("vscode-*.json")):
        try:
            entry = json.loads(f.read_text())
            info = call(entry["port"], entry["token"], "/ping")
        except urllib.error.URLError as e:
            # Only a *refused* connection proves the window is gone; a timeout or
            # a hiccup does not. Deleting the entry of a live window would silently
            # unplug it from Walkie Talkie, and it is only republished at activation.
            if isinstance(e.reason, ConnectionRefusedError):
                f.unlink(missing_ok=True)
            continue
        except Exception:
            continue
        folder = info.get("folder")
        if want_folder and folder != want_folder:
            continue
        if only_focused and not info.get("focused"):
            continue
        try:
            call(entry["port"], entry["token"], "/reload", method="POST")
        except Exception as e:
            print(f"could not reload {folder}: {e}", file=sys.stderr)
            continue
        done.append(folder or "?")

    if not done:
        print("no VS Code window matched — nothing reloaded", file=sys.stderr)
        return 1
    print("reloaded: " + ", ".join(done))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

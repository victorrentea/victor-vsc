#!/usr/bin/env python3
"""Open a file in the VS Code window that actually owns it.

`open vscode://file/<abs>:<line>:1` hands the path to macOS, which hands it to the
VS Code *application* — and from there VS Code picks the window itself. Measured on
1.135 it picks well: with three windows open on three checkouts of the same project,
a link into each landed in the window holding that checkout, even when another was
last-active. So this script is not a rescue for the common case.

It exists for the cases where that guess is not available or not right:

- **a path no open window owns** goes to the last-active window. The file is correct
  (the URL carries an absolute path) but it lands inside a window titled after a
  different project — and the reference next to it, `path:line` pasted into Quick
  Open, then resolves against *that* project, where the same relative path exists
  with different content. That is the failure worth designing against: not an error,
  a plausible wrong file.
- **two VS Code instances.** LaunchServices knows one application. Whichever main
  process answers can only route among *its own* windows, so a path owned by a
  window of the other instance opens in a window of this one. The registry here is
  per *extension host*, so it spans instances that cannot see each other.
- **the raise.** Being told about it is half of it; landing in front of it is the
  other half.

Selection is by longest matching workspace-folder prefix — a window opened on
`~/workspace/petclinic-pr` beats one opened on `~/workspace`, because the deeper
folder is the more specific claim on the path.

Usage:
  ./open-in-editor.py /abs/path/File.java:120
  ./open-in-editor.py "vscode://file//abs/path/File.java:120:1"
  ./open-in-editor.py /abs/path/File.java --line 120
  ./open-in-editor.py /abs/path/File.java --dry-run   # say where it would go
  ./open-in-editor.py /abs/path/File.java --no-focus  # open it, leave the screen alone
"""
import json, os, re, subprocess, sys, urllib.error, urllib.parse, urllib.request
from pathlib import Path

REGISTRY = Path.home() / ".walkie-talkie" / "ide"


def call(entry, path, method="GET", payload=None, timeout=5):
    req = urllib.request.Request(
        f"http://127.0.0.1:{entry['port']}{path}", method=method,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={"x-relay-token": entry["token"], "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def alive(pid):
    """Is the extension host that wrote this entry still running?

    A crashed window leaves its file behind — `deactivate()` never ran — and the OS
    is free to hand that port number to something else. The token check below is the
    real guard (a stranger cannot know it, and answers 403 or garbage), but a dead
    pid settles it without a network round trip."""
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True  # someone else's process — alive, just not ours to signal


def windows(prune=True):
    """Every live VS Code window, as (entry, ping).

    The ping *is* the staleness check: an entry is trusted only once the process it
    names answers, on its port, with our token, saying it is VS Code. Entries whose
    port is *refused* are deleted — that is proof the window is gone. A timeout is
    not proof of anything and deletes nothing: a busy extension host that loses its
    registry file is unplugged from Walkie Talkie until its next activation."""
    for f in sorted(REGISTRY.glob("vscode-*.json")):
        try:
            entry = json.loads(f.read_text())
        except Exception:
            continue
        if not alive(entry.get("pid", -1)):
            if prune:
                f.unlink(missing_ok=True)
            continue
        try:
            info = call(entry, "/ping", timeout=3)
        except urllib.error.URLError as e:
            if prune and isinstance(e.reason, ConnectionRefusedError):
                f.unlink(missing_ok=True)
            continue
        except Exception:
            continue
        if info.get("ok") and info.get("app") == "vscode":
            yield entry, info


def owns(info, target: Path):
    """How strongly this window claims `target`: the length of the longest workspace
    folder that is a prefix of it, or 0 for no claim.

    Both spellings of every folder are tried, and the target is compared as given and
    resolved: a checkout reached through a symlink is one tree with two names, and
    which name the caller holds is an accident of how it computed the path."""
    best = 0
    candidates = {target}
    try:
        candidates.add(target.resolve())
    except OSError:
        pass
    for folder in info.get("folders") or []:
        for spelling in (folder.get("path"), folder.get("realPath")):
            if not spelling:
                continue
            root = Path(spelling)
            for cand in candidates:
                if cand == root or root in cand.parents:
                    best = max(best, len(str(root)))
    return best


def parse_target(arg: str):
    """`/a/b.java:12:3`, `/a/b.java:12` or a `vscode://file/…` URL → (path, line)."""
    if arg.startswith("vscode://"):
        arg = urllib.parse.unquote(re.sub(r"^vscode://file/*", "/", arg))
    m = re.match(r"^(?P<path>.*?)(?::(?P<line>\d+))?(?::\d+)?$", arg)
    return Path(m.group("path")), int(m.group("line") or 1)


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    if not args:
        print(__doc__, file=sys.stderr)
        return 2
    target, line = parse_target(args[0])
    if "--line" in argv:
        line = int(argv[argv.index("--line") + 1])
    if not target.is_absolute():
        print(f"absolute path required, got {target}", file=sys.stderr)
        return 2

    ranked = sorted(((owns(i, target), e, i) for e, i in windows()),
                    key=lambda t: -t[0])
    owner = next(((e, i) for score, e, i in ranked if score), None)

    if owner and "--dry-run" in argv:
        print(f"would open in {owner[1].get('folder')!r}: {target}:{line}")
        return 0
    if owner:
        entry, info = owner
        try:
            call(entry, "/open-file", method="POST",
                 payload={"path": str(target), "line": line,
                          "focus": "--no-focus" not in argv})
            print(f"opened in the {info.get('folder')!r} window: {target}:{line}")
            return 0
        except Exception as e:
            # The window answered /ping a moment ago and has since gone, or refused
            # the file. Falling through is strictly better than reporting failure:
            # the OS route is what would have happened without this script at all.
            print(f"the {info.get('folder')!r} window would not take it ({e}) — "
                  f"handing it to the OS", file=sys.stderr)

    # Nobody owns it (or the owner just died). Today's behaviour, unchanged: let VS
    # Code choose. It is a guess, but it is a guess that opens the right *file*.
    if "--dry-run" in argv:
        print(f"no open window owns {target} — would fall back to the OS")
        return 0
    subprocess.run(["open", f"vscode://file/{target}:{line}:1"], capture_output=True)
    print(f"no open window owns {target} — handed to the OS")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

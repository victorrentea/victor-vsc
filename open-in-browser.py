#!/usr/bin/env python3
"""Show a URL in a VS Code window's embedded browser, beside the code.

A script running in an integrated terminal cannot aim at the window it runs in:
nothing in the environment identifies it. So we ask every window's extension host
who it is (/ping) and tell the matching one to open the page (/open-url) — the
same registry under ~/.walkie-talkie/ide/ that reload-window.py uses.

Default target is the window whose workspace folder is the current git root,
which is what "the window I ran this from" means in practice. --focused is a
worse default than it looks: while a command runs in a terminal the window is
often *not* the focused one (Victor watches another window while an agent works).

The URL must be http(s). Both embedded browsers refuse file:// — serve the
directory instead.

Usage:
  ./open-in-browser.py http://localhost:7654/review.html
  ./open-in-browser.py URL --folder petclinic
  ./open-in-browser.py URL --any          # first window that answers
"""
import json, subprocess, sys, urllib.error, urllib.request, pathlib

REGISTRY = pathlib.Path.home() / ".walkie-talkie" / "ide"


def call(port, token, path, method="GET", payload=None):
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}", method=method,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={"x-relay-token": token, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.load(r)


def windows():
    """Every live window, as (entry, ping). Prunes only entries that are refused —
    a timeout does not prove a window is gone, and deleting a live one's entry
    unplugs it from Walkie Talkie until its next activation."""
    for f in sorted(REGISTRY.glob("vscode-*.json")):
        try:
            entry = json.loads(f.read_text())
            yield entry, call(entry["port"], entry["token"], "/ping")
        except urllib.error.URLError as e:
            if isinstance(e.reason, ConnectionRefusedError):
                f.unlink(missing_ok=True)
        except Exception:
            pass


def git_root_name():
    try:
        out = subprocess.run(["git", "rev-parse", "--show-toplevel"],
                             capture_output=True, text=True, timeout=5)
        return pathlib.Path(out.stdout.strip()).name if out.returncode == 0 else None
    except Exception:
        return None


def main(argv):
    urls = [a for a in argv if not a.startswith("--")]
    if not urls:
        print(__doc__, file=sys.stderr)
        return 2
    url = urls[0]
    if not url.startswith(("http://", "https://")):
        print("http(s) only — an embedded browser cannot load file:// URLs", file=sys.stderr)
        return 2

    want = argv[argv.index("--folder") + 1] if "--folder" in argv else None
    if want is None and "--any" not in argv:
        want = git_root_name()
    beside = "--active" not in argv

    candidates = [(e, i) for e, i in windows()]
    matched = [(e, i) for e, i in candidates if not want or i.get("folder") == want]
    if not matched and want and "--strict" not in argv:
        # A window with no folder open, or a differently named one, is still a
        # better answer than refusing: the alternative is the report never shown.
        print(f"no VS Code window has the folder {want!r} — falling back", file=sys.stderr)
        matched = candidates
    if "--focused" in argv:
        matched = [(e, i) for e, i in matched if i.get("focused")] or matched

    for entry, info in matched:
        try:
            r = call(entry["port"], entry["token"], "/open-url", method="POST",
                     payload={"url": url, "beside": beside})
        except Exception as e:
            print(f"could not reach the window {info.get('folder')!r}: {e}", file=sys.stderr)
            continue
        print(f"opened in VS Code ({info.get('folder') or 'no folder'}, {r.get('view')}): {url}")
        return 0

    print("no VS Code window answered — open the URL yourself", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

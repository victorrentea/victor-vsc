#!/usr/bin/env python3
"""What did I look at in VS Code? Reads the log written by view-log.js.

    ./view-log.py                                   # today, segment by segment
    ./view-log.py --since "2026-10-13 19:00" --until "2026-10-13 21:30" --file "BE JUG"
    ./view-log.py --day 2026-10-13 --lines          # per file: the cursor lines, longest first, with their text
    ./view-log.py --day 2026-10-13 --presenting     # only while Vic Presentation was on

Times are local. The text shown is the file as it was on screen then (snapshots/), not as it is now.
"""
import argparse
import datetime as dt
import json
import pathlib
import sys
from collections import defaultdict

ROOT = pathlib.Path.home() / '.victor-vsc' / 'view-log'


def local(iso):
    return dt.datetime.fromisoformat(iso.replace('Z', '+00:00')).astimezone()


def parse_when(s):
    return dt.datetime.fromisoformat(s).astimezone()


def records(since, until):
    day = since.date()
    while day <= until.date():
        f = ROOT / f'{day.isoformat()}.jsonl'
        if f.exists():
            for raw in f.read_text().splitlines():
                try:
                    r = json.loads(raw)
                except ValueError:
                    continue
                if local(r['to']) >= since and local(r['from']) <= until:
                    yield r
        day += dt.timedelta(days=1)


_snapshots = {}


def line_text(sha, line):
    if not sha:
        return None
    if sha not in _snapshots:
        p = ROOT / 'snapshots' / f'{sha}.txt'
        _snapshots[sha] = p.read_text(errors='replace').split('\n') if p.exists() else None
    lines = _snapshots[sha]
    return lines[line - 1].rstrip() if lines and 0 < line <= len(lines) else None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--day', help='YYYY-MM-DD (default: today)')
    ap.add_argument('--since', help='"YYYY-MM-DD HH:MM", local time')
    ap.add_argument('--until', help='"YYYY-MM-DD HH:MM", local time')
    ap.add_argument('--file', help='only files whose path contains this')
    ap.add_argument('--presenting', action='store_true', help='only while Vic Presentation was on')
    ap.add_argument('--lines', action='store_true', help='per file: cursor lines by total time, with their text')
    ap.add_argument('--json', action='store_true', help='raw records')
    a = ap.parse_args()

    day = dt.date.fromisoformat(a.day) if a.day else dt.date.today()
    since = parse_when(a.since) if a.since else dt.datetime.combine(day, dt.time.min).astimezone()
    until = parse_when(a.until) if a.until else dt.datetime.combine(since.date() if a.since else day, dt.time.max).astimezone()

    rs = [r for r in records(since, until)
          if (not a.file or a.file.lower() in r['file'].lower()) and (not a.presenting or r.get('presenting'))]
    if not rs:
        print(f'nothing logged between {since:%Y-%m-%d %H:%M} and {until:%Y-%m-%d %H:%M}', file=sys.stderr)
        return 1
    if a.json:
        for r in rs:
            print(json.dumps(r))
        return 0

    if a.lines:
        # (line, text as it was then): an edit that moves a line makes it a separate entry, not a wrong one
        per_file = defaultdict(lambda: defaultdict(int))
        for r in rs:
            for line, sec in r['cursor']:
                per_file[r['file']][(line, line_text(r.get('sha'), line) or '')] += sec
        for f, lines in sorted(per_file.items(), key=lambda kv: -sum(kv[1].values())):
            print(f'\n{f}  ({sum(lines.values()) // 60} min)')
            for (line, text), sec in sorted(lines.items(), key=lambda kv: -kv[1])[:40]:
                print(f'  {line:>5}  {sec:>5}s  {text}')
        return 0

    for r in rs:
        flags = ' [presenting]' if r.get('presenting') else ''
        flags += ' [background]' if r.get('focused') is False else ''
        vis = ', '.join(f'{a}-{b}' for a, b in r['visible'])
        print(f"{local(r['from']):%H:%M:%S}-{local(r['to']):%H:%M:%S} {r['seconds']:>4}s  {r['file']}  lines {vis}{flags}")
        for line, sec in r['cursor']:
            text = line_text(r.get('sha'), line)
            print(f'      > {line:>5} {sec:>4}s  {text if text is not None else ""}')
    return 0


if __name__ == '__main__':
    sys.exit(main())

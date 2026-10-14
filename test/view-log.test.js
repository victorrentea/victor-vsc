// Plain node, no VS Code host: `node --test test/view-log.test.js`. What a view-log
// segment records: which lines were on screen, how long the cursor sat on each.
const test = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');

const load = Module._load;
Module._load = (req, ...rest) => (req === 'vscode' ? {} : load(req, ...rest));
const { sameView, newSegment, moveCursor, noteSelection, segmentRecord, expiredDays, SECRET_NAME } = require('../view-log');
Module._load = load;

const view = (visible, extra = {}) => ({ file: '/notes.txt', visible, focused: true, presenting: false, ...extra });
const T0 = Date.UTC(2026, 9, 13, 18, 0, 0);

test('moving the cursor keeps the view; scrolling or switching file does not', () => {
  assert.ok(sameView(view([[1, 40]]), view([[1, 40]])));
  assert.ok(!sameView(view([[1, 40]]), view([[2, 41]])));
  assert.ok(!sameView(view([[1, 40]]), view([[1, 40]], { file: '/other.txt' })));
  assert.ok(!sameView(view([[1, 40]]), view([[1, 40]], { focused: false })));
  assert.ok(!sameView(view([[1, 40]]), null));
});

test('the record holds how long the cursor sat on each line, in order of first visit', () => {
  const seg = newSegment(view([[1, 10], [20, 40]]), T0, 3, null);
  moveCursor(seg, 7, T0 + 30000);
  moveCursor(seg, 3, T0 + 30400);   // passing over 7 for 0.4 s: dropped
  moveCursor(seg, 25, T0 + 50000);
  const rec = segmentRecord(seg, T0 + 90000, 'a'.repeat(40));
  assert.deepStrictEqual(rec.cursor, [[3, 50], [25, 40]]);
  assert.deepStrictEqual(rec.visible, [[1, 10], [20, 40]]);
  assert.strictEqual(rec.seconds, 90);
  assert.strictEqual(rec.from, '2026-10-13T18:00:00.000Z');
  assert.strictEqual(rec.sha, 'a'.repeat(40));
  assert.ok(!('focused' in rec) && !('presenting' in rec) && !('selections' in rec));
});

test('a glance shorter than the minimum dwell is not a view', () => {
  assert.strictEqual(segmentRecord(newSegment(view([[1, 40]]), T0, 1, null), T0 + 1000), null);
});

test('selections are kept once each; background presenting is flagged', () => {
  const seg = newSegment(view([[1, 40]], { focused: false, presenting: true }), T0, 5, [5, 8]);
  noteSelection(seg, [5, 8]);
  noteSelection(seg, [12, 12]);
  const rec = segmentRecord(seg, T0 + 5000);
  assert.deepStrictEqual(rec.selections, [[5, 8], [12, 12]]);
  assert.strictEqual(rec.focused, false);
  assert.strictEqual(rec.presenting, true);
  assert.ok(!('sha' in rec));
});

test('day files older than the retention are expired, others kept', () => {
  const names = ['2026-10-01.jsonl', '2026-10-05.jsonl', '2026-10-06.jsonl', '2026-10-14.jsonl', 'snapshots'];
  assert.deepStrictEqual(expiredDays(names, new Date(2026, 9, 14, 12).getTime(), 8), ['2026-10-01.jsonl', '2026-10-05.jsonl']);
});

test('secret-looking files get no snapshot', () => {
  for (const f of ['/a/.env', '/a/.env.local', '/a/secrets.env', '/a/id.pem', '/a/server.key', '/a/github-token.txt'])
    assert.ok(SECRET_NAME.test(f), f);
  for (const f of ['/a/notes.txt', '/a/Patterns and Anti-Patterns@BE JUG.txt', '/a/keyboard.md', '/a/env.js'])
    assert.ok(!SECRET_NAME.test(f), f);
});

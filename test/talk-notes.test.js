// Plain node, no VS Code host: `node --test test/talk-notes.test.js`. What is folded,
// read off the editor's visible ranges, and how an edit moves it.
const test = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');

const load = Module._load;
Module._load = (req, ...rest) => (req === 'vscode' ? {} : load(req, ...rest));
const { foldsFromVisible, shiftFolds, isHeader } = require('../talk-notes');
Module._load = load;

const LINES = ['* A', '  + a1', '  + a2', '', '- B', '  i b1', '', '- C', '  + c1'];
const textAt = (i) => LINES[i];

test('a header is a line whose next non-blank line is deeper', () => {
  assert.deepStrictEqual(LINES.map((_, i) => isHeader(i, LINES.length, textAt)),
    [true, false, false, false, true, false, false, true, false]);
});

test('a gap after a header means folded; its next line visible means unfolded', () => {
  // B folded (line 5 hidden), A and C open.
  const folds = foldsFromVisible([[0, 4], [6, 8]], LINES.length, textAt, new Map());
  assert.deepStrictEqual([...folds].sort(), [[0, false], [4, true], [7, false]]);
});

test('a header on the last line of the viewport keeps what was known', () => {
  const known = new Map([[7, true]]);
  const folds = foldsFromVisible([[3, 7]], LINES.length, textAt, known);
  assert.strictEqual(folds.get(7), true);
  assert.strictEqual(folds.get(4), false);
});

test('an edit shifts the folds below it and drops the ones it replaced', () => {
  const folds = new Map([[0, true], [4, true], [7, false]]);
  // two lines inserted at line 2
  assert.deepStrictEqual([...shiftFolds(folds, 2, 2, 2)], [[0, true], [6, true], [9, false]]);
  // lines 3..5 replaced by one line: the header at 4 went with them
  assert.deepStrictEqual([...shiftFolds(folds, 3, 5, 0)], [[0, true], [5, false]]);
});

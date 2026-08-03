import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRowOffset } from './window.js';

const call = (over: Partial<Parameters<typeof resolveRowOffset>[0]>) =>
  resolveRowOffset({ base: 0, row: 0, viewport: 5, rowCount: 20, headerAbove: false, ...over });

test('keeps the offset when the row is already visible', () => {
  assert.equal(call({ base: 3, row: 5 }), 3);
});

test('scrolls down just enough to reveal a row below the viewport', () => {
  assert.equal(call({ base: 0, row: 7 }), 3);
});

test('scrolls up to the row when it sits above the viewport', () => {
  assert.equal(call({ base: 10, row: 4 }), 4);
});

test('pulls a directly preceding header into view with its row', () => {
  assert.equal(call({ base: 10, row: 4, headerAbove: true }), 3);
});

test('clamps to the last full page', () => {
  assert.equal(call({ base: 99, row: 19, rowCount: 20, viewport: 5 }), 15);
});

test('returns 0 when everything fits', () => {
  assert.equal(call({ base: 4, row: 2, rowCount: 3, viewport: 5 }), 0);
});

test('never returns a negative offset', () => {
  assert.equal(call({ base: -5, row: 0, headerAbove: true }), 0);
});

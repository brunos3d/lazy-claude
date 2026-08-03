import test from 'node:test';
import assert from 'node:assert/strict';
import { SearchHistory } from './SearchHistory.js';

test('records queries newest first', () => {
  SearchHistory.clear();
  SearchHistory.record('docker');
  SearchHistory.record('billing');
  assert.deepEqual(SearchHistory.list(), ['billing', 'docker']);
});

test('re-running a query moves it to the front instead of duplicating', () => {
  SearchHistory.clear();
  SearchHistory.record('docker');
  SearchHistory.record('billing');
  SearchHistory.record('DOCKER');
  assert.deepEqual(SearchHistory.list(), ['DOCKER', 'billing']);
});

test('caps at ten entries', () => {
  SearchHistory.clear();
  for (let i = 0; i < 15; i++) SearchHistory.record(`query-${i}`);
  const list = SearchHistory.list();
  assert.equal(list.length, 10);
  assert.equal(list[0], 'query-14');
  assert.equal(list[9], 'query-5');
});

test('ignores empty and whitespace-only queries', () => {
  SearchHistory.clear();
  SearchHistory.record('');
  SearchHistory.record('   ');
  assert.deepEqual(SearchHistory.list(), []);
});

test('trims recorded queries', () => {
  SearchHistory.clear();
  SearchHistory.record('  docker  ');
  assert.deepEqual(SearchHistory.list(), ['docker']);
});

test('list returns a copy, so callers cannot mutate the history', () => {
  SearchHistory.clear();
  SearchHistory.record('docker');
  SearchHistory.list().push('injected');
  assert.deepEqual(SearchHistory.list(), ['docker']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { FilterService, matchTier, type SearchDocument } from './FilterService.js';

const doc = (label: string): SearchDocument<string> => ({
  item: label,
  fields: [{ key: 'label', value: label, weight: 1, highlight: true }],
});

test('matchTier classifies exact, prefix, substring and subsequence', () => {
  assert.equal(matchTier('docker', 'docker'), 3);
  assert.equal(matchTier('Docker', 'docker'), 3);
  assert.equal(matchTier('docker-compose', 'docker'), 2);
  assert.equal(matchTier('my-docker-setup', 'docker'), 1);
  assert.equal(matchTier('do not call the broker', 'docker'), 0);
});

test('tiers order results ahead of raw fuzzy score', () => {
  const results = FilterService.filter(
    [
      doc('do not call the broker'),
      doc('my-docker-setup'),
      doc('docker-compose'),
      doc('docker'),
    ],
    'docker',
  );
  assert.deepEqual(results.map((r) => r.item), [
    'docker',
    'docker-compose',
    'my-docker-setup',
    'do not call the broker',
  ]);
});

test('ties inside a tier keep the caller order, which is recency', () => {
  const results = FilterService.filter([doc('alpha-tool'), doc('alpha-kit')], 'alpha');
  assert.deepEqual(results.map((r) => r.item), ['alpha-tool', 'alpha-kit']);
});

test('an empty query returns every document untouched', () => {
  const results = FilterService.filter([doc('one'), doc('two')], '   ');
  assert.deepEqual(results.map((r) => r.item), ['one', 'two']);
  assert.equal(results[0].score, 0);
});

test('highlight positions still come back for highlighted fields', () => {
  const [result] = FilterService.filter([doc('docker')], 'dkr');
  assert.deepEqual(result.highlights.label, [0, 3, 5]);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { DISCIPLINE } from '../src/sim/engine.js';
import {
  confidenceInterval,
  METRICS,
  runReplications,
  tCritical95,
} from '../src/sim/replications.js';

const assertClose = (actual, expected, tolerance) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${expected}, got ${actual}`);

test('critical values of t match the table', () => {
  assert.equal(tCritical95(1), 12.706);
  assert.equal(tCritical95(9), 2.262);
  assert.equal(tCritical95(29), 2.045);
  assert.equal(tCritical95(30), 2.042);
});

test('above 30 degrees of freedom, critical values stay close to the table and approach 1.96', () => {
  assertClose(tCritical95(40), 2.021, 0.0005);
  assertClose(tCritical95(60), 2.0, 0.0005);
  assertClose(tCritical95(120), 1.98, 0.0005);
  assertClose(tCritical95(100_000), 1.96, 0.0005);
  // There must be no jump where the table hands over to the approximation.
  assert.ok(tCritical95(31) < tCritical95(30));
  assert.ok(tCritical95(30) - tCritical95(31) < 0.005);
});

test('the confidence interval matches the hand calculation', () => {
  // Mean 5; sum of squared deviations 32; s² = 32/7; t(0.975; 7) = 2.365
  const interval = confidenceInterval([2, 4, 4, 4, 5, 5, 7, 9]);
  const expectedHalfWidth = 2.365 * Math.sqrt(32 / 7 / 8);

  assert.equal(interval.n, 8);
  assertClose(interval.mean, 5, 1e-12);
  assertClose(interval.stdDev, Math.sqrt(32 / 7), 1e-12);
  assertClose(interval.halfWidth, expectedHalfWidth, 1e-12);
  assertClose(interval.lower, 5 - expectedHalfWidth, 1e-12);
  assertClose(interval.upper, 5 + expectedHalfWidth, 1e-12);
});

test('a single observation gives a mean but no interval', () => {
  const interval = confidenceInterval([3.5]);
  assert.equal(interval.mean, 3.5);
  assert.equal(interval.n, 1);
  assert.ok(Number.isNaN(interval.halfWidth));
});

test('non-finite values are skipped', () => {
  const interval = confidenceInterval([1, Number.NaN, 3, Infinity]);
  assert.equal(interval.n, 2);
  assert.equal(interval.mean, 2);
  assert.ok(Number.isNaN(confidenceInterval([]).mean));
});

test('replications can be repeated exactly and differ from one another', () => {
  const config = { arrivalRate: 8, serviceRate: 10, duration: 300, warmup: 30, seed: 5 };
  const first = runReplications(config, 6);
  const second = runReplications(config, 6);

  assert.deepEqual(second, first);
  assert.equal(first.runs.length, 6);
  assert.equal(new Set(first.runs.map((run) => run.L)).size, 6, 'each replication has its own sequence');
  for (const metric of METRICS) {
    const { mean, lower, upper, n } = first.summary[metric];
    assert.equal(n, 6);
    assert.ok(lower < mean && mean < upper, metric);
  }
});

test('the per-class summary exists only for the priority discipline', () => {
  const config = { arrivalRate: 8, serviceRate: 10, duration: 300, seed: 5 };

  assert.equal(runReplications(config, 3).summary.WqByClass, undefined);

  const { summary } = runReplications({ ...config, discipline: DISCIPLINE.PRIORITY }, 3);
  assert.equal(summary.WqByClass.length, 2);
  assert.ok(summary.WqByClass[0].mean < summary.WqByClass[1].mean);
});

test('the number of replications must be a positive integer', () => {
  const config = { arrivalRate: 8, serviceRate: 10, duration: 10 };
  assert.throws(() => runReplications(config, 0), RangeError);
  assert.throws(() => runReplications(config, 2.5), RangeError);
});

test('progress is reported each time a replication finishes', () => {
  const calls = [];
  runReplications({ arrivalRate: 8, serviceRate: 10, duration: 20 }, 4, (done, total) =>
    calls.push([done, total]),
  );
  assert.deepEqual(calls, [
    [1, 4],
    [2, 4],
    [3, 4],
    [4, 4],
  ]);
});

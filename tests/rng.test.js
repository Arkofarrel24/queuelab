import assert from 'node:assert/strict';
import test from 'node:test';

import { createRng, exponential, STREAM } from '../src/sim/rng.js';

const take = (rng, count) => Array.from({ length: count }, () => rng());

test('the same seed produces the same sequence', () => {
  assert.deepEqual(take(createRng(42, 3, STREAM.ARRIVAL), 100), take(createRng(42, 3, STREAM.ARRIVAL), 100));
});

test('a different seed, replication, or stream produces a different sequence', () => {
  const base = take(createRng(42, 0, STREAM.ARRIVAL), 20);

  assert.notDeepEqual(take(createRng(43, 0, STREAM.ARRIVAL), 20), base);
  assert.notDeepEqual(take(createRng(42, 1, STREAM.ARRIVAL), 20), base);
  assert.notDeepEqual(take(createRng(42, 0, STREAM.SERVICE), 20), base);
});

test('uniform numbers lie in [0, 1) with mean 1/2 and variance 1/12', () => {
  const values = take(createRng(2024), 200_000);
  const mean = values.reduce((sum, u) => sum + u, 0) / values.length;
  const variance = values.reduce((sum, u) => sum + (u - mean) ** 2, 0) / values.length;

  assert.ok(values.every((u) => u >= 0 && u < 1));
  assert.ok(Math.abs(mean - 1 / 2) < 0.005, `mean ${mean}`);
  assert.ok(Math.abs(variance - 1 / 12) < 0.002, `variance ${variance}`);
});

test('uniform numbers are spread evenly over ten classes', () => {
  const counts = new Array(10).fill(0);
  const total = 200_000;
  const rng = createRng(99);
  for (let i = 0; i < total; i++) counts[Math.floor(rng() * 10)]++;

  // Chi-square goodness-of-fit test: 9 degrees of freedom, 1% critical value 21.67.
  const expected = total / 10;
  const chiSquare = counts.reduce((sum, count) => sum + (count - expected) ** 2 / expected, 0);
  assert.ok(chiSquare < 21.67, `chi-square ${chiSquare}`);
});

test('exponential variates have mean 1/rate and standard deviation 1/rate', () => {
  const rate = 8;
  const rng = createRng(5, 0, STREAM.SERVICE);
  const values = Array.from({ length: 200_000 }, () => exponential(rng, rate));
  const mean = values.reduce((sum, x) => sum + x, 0) / values.length;
  const stdDev = Math.sqrt(values.reduce((sum, x) => sum + (x - mean) ** 2, 0) / values.length);

  assert.ok(values.every((x) => x >= 0 && Number.isFinite(x)));
  // The hallmark of the exponential distribution: its standard deviation equals its mean.
  assert.ok(Math.abs(mean - 1 / rate) / (1 / rate) < 0.01, `mean ${mean}`);
  assert.ok(Math.abs(stdDev - 1 / rate) / (1 / rate) < 0.02, `standard deviation ${stdDev}`);
});

test('exponential variates satisfy P(X > x) = e^(-rate * x)', () => {
  const rate = 2;
  const rng = createRng(11);
  const total = 200_000;
  let exceed = 0;
  for (let i = 0; i < total; i++) if (exponential(rng, rate) > 1) exceed++;

  assert.ok(Math.abs(exceed / total - Math.exp(-rate)) < 0.005, `share ${exceed / total}`);
});

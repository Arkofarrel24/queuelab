import assert from 'node:assert/strict';
import test from 'node:test';

import { BinnedSeries } from '../src/stats/binned-series.js';
import { niceCeil, niceFloor, WaitHistogram } from '../src/stats/wait-histogram.js';

const assertClose = (actual, expected, tolerance = 1e-9, label = '') =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label} expected ${expected}, got ${actual}`,
  );

// ---------------------------------------------------------------------------
// BinnedSeries
// ---------------------------------------------------------------------------

test('the per-bin average matches the hand calculation', () => {
  const series = new BinnedSeries({ binWidth: 1 });
  series.add(0, 0.5, 0);
  series.add(0.5, 1.5, 2); // half in the first bin, half in the second
  series.add(1.5, 3, 4);

  const points = series.points();
  assert.equal(points.length, 3);
  assertClose(points[0].mean, 1); // (0·0.5 + 2·0.5) / 1
  assertClose(points[1].mean, 3); // (2·0.5 + 4·0.5) / 1
  assertClose(points[2].mean, 4);
  assert.deepEqual(
    points.map((point) => [point.from, point.to]),
    [
      [0, 1],
      [1, 2],
      [2, 3],
    ],
  );
});

test('the last, unfinished bin is averaged over the part that has elapsed', () => {
  const series = new BinnedSeries({ binWidth: 10 });
  series.add(0, 4, 3);

  const [point] = series.points();
  assertClose(point.to, 4);
  assertClose(point.mean, 3);
});

test('the running average starts after the warm-up period', () => {
  const series = new BinnedSeries({ binWidth: 1, averageFrom: 1.5 });
  series.add(0, 1, 100); // entirely within the warm-up, so not counted
  series.add(1, 2, 6); // only [1.5, 2] is counted
  series.add(2, 3, 2);

  const [first, second, third] = series.points();
  assert.equal(first.runningMean, null);
  assertClose(second.runningMean, 6); // area 6·0.5 divided by 0.5
  assertClose(third.runningMean, (6 * 0.5 + 2 * 1) / 1.5);
});

test('merging bins preserves the total area and the running average', () => {
  const fine = new BinnedSeries({ binWidth: 1, maxBins: 1000, averageFrom: 3 });
  const coarse = new BinnedSeries({ binWidth: 1, maxBins: 8, averageFrom: 3 });

  // A step signal that changes at irregular times.
  let time = 0;
  for (let i = 0; i < 300; i++) {
    const next = time + 0.05 + ((i * 37) % 11) / 10;
    const value = (i * 7) % 5;
    fine.add(time, next, value);
    coarse.add(time, next, value);
    time = next;
  }

  const area = (series) =>
    series.points().reduce((sum, point) => sum + point.mean * (point.to - point.from), 0);
  const coarsePoints = coarse.points();

  assert.ok(coarsePoints.length <= 8);
  assert.ok(coarse.binWidth > fine.binWidth);
  assertClose(area(coarse), area(fine), 1e-6, 'total area');
  assertClose(coarsePoints.at(-1).runningMean, fine.points().at(-1).runningMean, 1e-9);
  assertClose(coarsePoints.at(-1).to, time);
});

test('a long empty stretch does not blow up the number of points', () => {
  const series = new BinnedSeries({ binWidth: 0.001, maxBins: 100 });
  series.add(0, 5000, 1);

  const points = series.points();
  assert.ok(points.length <= 100);
  for (const point of points) assertClose(point.mean, 1);
});

test('a zero-length interval is ignored', () => {
  const series = new BinnedSeries({ binWidth: 1 });
  series.add(2, 2, 99);
  assert.deepEqual(series.points(), []);
});

// ---------------------------------------------------------------------------
// WaitHistogram
// ---------------------------------------------------------------------------

test('niceCeil and niceFloor round to the series 1, 2, 5, 10', () => {
  assert.deepEqual([0.3, 1, 1.2, 2, 3, 7, 10, 12, 60].map(niceCeil), [0.5, 1, 2, 2, 5, 10, 10, 20, 100]);
  assert.deepEqual([0.3, 1, 1.2, 2, 3, 7, 10, 12, 60].map(niceFloor), [0.2, 1, 1, 2, 2, 5, 10, 10, 50]);
});

test('customers who did not wait are counted separately', () => {
  const histogram = new WaitHistogram(1);
  for (const wait of [0, 0, 0, 0.5, 1.5, 1.7]) histogram.add(wait);

  const { zeroShare, bars, overflow, width } = histogram.bars(20, 1);
  assert.equal(histogram.total, 6);
  assert.equal(width, 1);
  assertClose(zeroShare, 3 / 6);
  assertClose(bars[0].share, 1 / 6); // (0, 1]
  assertClose(bars[1].share, 2 / 6); // (1, 2]
  assertClose(overflow.share, 0);
  assertClose(histogram.mean, 3.7 / 6);
});

test('all parts of the histogram add up to one', () => {
  const histogram = new WaitHistogram(0.5);
  for (let i = 0; i < 5000; i++) histogram.add(i % 7 === 0 ? 0 : (i * 0.37) % 90);

  const { zeroShare, bars, overflow } = histogram.bars();
  const total = zeroShare + overflow.share + bars.reduce((sum, bar) => sum + bar.share, 0);
  assertClose(total, 1);
});

test('the bar width grows with the data and stays a round number', () => {
  const histogram = new WaitHistogram(1);
  for (let i = 1; i <= 100; i++) histogram.add(i - 0.5); // uniform on (0, 100)

  const { bars, width, overflow } = histogram.bars(20, 0.99);
  assert.equal(width, 5); // 99 fine bins must fit into 20 bars, so 5 per bar
  assert.equal(bars.length, 20);
  assert.equal(bars.at(-1).to, 100);
  assertClose(overflow.share, 0);
});

test('a long thin tail goes into the "more than" bar', () => {
  const histogram = new WaitHistogram(1);
  for (let i = 0; i < 995; i++) histogram.add(0.5 + (i % 10));
  for (let i = 0; i < 5; i++) histogram.add(5000);

  const { bars, overflow } = histogram.bars(20, 0.99);
  assert.equal(bars.at(-1).to, 10);
  assertClose(overflow.share, 5 / 1000);
  assert.equal(overflow.from, 10);
});

test('an empty histogram does not produce NaN', () => {
  const { zeroShare, bars, overflow } = new WaitHistogram(1).bars();
  assert.equal(zeroShare, 0);
  assert.equal(overflow.share, 0);
  assert.ok(bars.every((bar) => bar.share === 0));
});

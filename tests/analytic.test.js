import assert from 'node:assert/strict';
import test from 'node:test';

import {
  analyze,
  erlangC,
  mm1,
  mmc,
  mmck,
  priorityWaits,
} from '../src/analytic/formulas.js';
import { DISCIPLINE } from '../src/sim/engine.js';

const METRICS = ['rho', 'L', 'Lq', 'W', 'Wq', 'P0'];

function assertClose(actual, expected, tolerance = 1e-12, label = '') {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label} expected ${expected}, got ${actual}`,
  );
}

function assertMetrics(result, expected, tolerance = 1e-12) {
  for (const [metric, value] of Object.entries(expected)) {
    assertClose(result[metric], value, tolerance, metric);
  }
}

/** Numerical integral ∫ f(t) dt from 0 to `upper` by the trapezoidal rule. */
function integrate(f, upper, steps = 200_000) {
  const h = upper / steps;
  let sum = (f(0) + f(upper)) / 2;
  for (let i = 1; i < steps; i++) sum += f(i * h);
  return sum * h;
}

// ---------------------------------------------------------------------------
// Textbook examples
// ---------------------------------------------------------------------------

test('M/M/1: muffler shop, λ = 2 and μ = 3 per hour (Heizer & Render, Model A)', () => {
  // Textbook answers: Ls = 2 cars, Ws = 1 hour, Lq = 1.33 cars, Wq = 40 minutes,
  // ρ = 66.6%, P0 = 0.33
  assertMetrics(mm1(2, 3), {
    rho: 2 / 3,
    L: 2,
    Lq: 4 / 3,
    W: 1,
    Wq: 2 / 3,
    P0: 1 / 3,
  });
  assertClose(mm1(2, 3).Wq * 60, 40, 1e-9, 'Wq in minutes');
});

test('M/M/2: the same shop with two mechanics (Heizer & Render, Model B)', () => {
  // Textbook answers: P0 = 0.5, Ls = 0.75 cars, Ws = 22.5 minutes,
  // Lq = 0.083 cars, Wq = 2.5 minutes
  const result = mmc(2, 3, 2);
  assertMetrics(result, {
    rho: 1 / 3,
    P0: 1 / 2,
    L: 3 / 4,
    W: 3 / 8,
    Lq: 1 / 12,
    Wq: 1 / 24,
  });
  assertClose(result.W * 60, 22.5, 1e-9, 'W in minutes');
  assertClose(result.Wq * 60, 2.5, 1e-9, 'Wq in minutes');
});

test('M/M/3/7: emission inspection station, λ = 1 per minute, 6-minute service (Gross & Harris)', () => {
  // State weights: 1, 6, 18, 36, 72, 144, 288, 576; they add up to 1141.
  // Textbook answers: p0 = 0.00088, Lq = 3.09 cars, L = 6.06 cars, W = 12.3 minutes,
  // and about 30.3 cars per hour cannot get in.
  const result = mmck(1, 1 / 6, 3, 7);

  assertMetrics(
    result,
    {
      P0: 1 / 1141,
      Lq: 3528 / 1141,
      L: 6918 / 1141,
      blockingProbability: 576 / 1141,
      effectiveArrivalRate: 565 / 1141,
      W: 6918 / 565,
      Wq: 3528 / 565,
      rho: 565 / 1141 / (3 / 6),
    },
    1e-10,
  );
  assertClose(result.P0, 0.00088, 5e-6);
  assertClose(result.Lq, 3.09, 5e-3);
  assertClose(result.L, 6.06, 5e-3);
  assertClose(result.W, 12.3, 0.06);
  assertClose(60 * 1 * result.blockingProbability, 30.3, 0.05, 'cars rejected per hour');
});

test('Erlang C matches values that can be worked out by hand', () => {
  assertClose(erlangC(1, 0.5), 0.5); // one server: C = ρ
  assertClose(erlangC(2, 1), 1 / 3);
  assertClose(erlangC(3, 2), 4 / 9);
  assert.equal(erlangC(2, 2), 1);
  assert.equal(erlangC(2, 5), 1);
});

// ---------------------------------------------------------------------------
// The closed form of M/M/1/K as an independent reference
// ---------------------------------------------------------------------------

test('M/M/1/K matches its closed form', () => {
  const lambda = 3;
  const mu = 4;
  const K = 6;
  const r = lambda / mu;
  // P0 = (1 - ρ)/(1 - ρ^(K+1));  L = ρ/(1 - ρ) - (K+1)ρ^(K+1)/(1 - ρ^(K+1))
  const P0 = (1 - r) / (1 - r ** (K + 1));
  const L = r / (1 - r) - ((K + 1) * r ** (K + 1)) / (1 - r ** (K + 1));
  const PK = P0 * r ** K;

  const result = mmck(lambda, mu, 1, K);
  assertMetrics(result, { P0, L, blockingProbability: PK, Lq: L - (1 - P0) }, 1e-12);
});

test('M/M/1/K with λ = μ: every state is equally likely', () => {
  const K = 9;
  const result = mmck(5, 5, 1, K);
  assertMetrics(result, { P0: 1 / (K + 1), blockingProbability: 1 / (K + 1), L: K / 2 });
});

// ---------------------------------------------------------------------------
// Consistency between models
// ---------------------------------------------------------------------------

test('M/M/c with one server equals M/M/1', () => {
  const single = mm1(8, 10);
  const multi = mmc(8, 10, 1);
  for (const metric of METRICS) assertClose(multi[metric], single[metric], 1e-12, metric);
  assertClose(multi.waitProbability, single.waitProbability);
});

test('M/M/c/K approaches M/M/c when K is very large', () => {
  const unlimited = mmc(24, 10, 3);
  const large = mmck(24, 10, 3, 400);
  for (const metric of METRICS) assertClose(large[metric], unlimited[metric], 1e-9, metric);
  assertClose(large.waitProbability, unlimited.waitProbability, 1e-9);
  assert.ok(large.blockingProbability < 1e-30);
});

test('M/M/c/c with no waiting room: there is no queue (the Erlang B model)', () => {
  // Erlang B formula for c = 2, a = 1: B = (a²/2!)/(1 + a + a²/2!) = 0.2
  const result = mmck(1, 1, 2, 2);
  assertClose(result.blockingProbability, 0.2);
  assert.equal(result.Lq, 0);
  assert.equal(result.Wq, 0);
  assert.equal(result.waitProbability, 0);
});

test("Little's law holds in every model", () => {
  const cases = [
    [mm1(8, 10), 8],
    [mmc(24, 10, 3), 24],
    [mmck(12, 10, 1, 5), null],
    [mmck(40, 10, 3, 8), null],
  ];
  for (const [result, lambda] of cases) {
    const rate = lambda ?? result.effectiveArrivalRate;
    assertClose(result.L, rate * result.W, 1e-12, `${result.model} L = λW`);
    assertClose(result.Lq, rate * result.Wq, 1e-12, `${result.model} Lq = λWq`);
  }
});

// ---------------------------------------------------------------------------
// Instability and numerical robustness
// ---------------------------------------------------------------------------

test('ρ >= 1 with an unlimited queue is reported as unstable', () => {
  for (const result of [mm1(10, 10), mm1(12, 10), mmc(30, 10, 3), mmc(45, 10, 3)]) {
    assert.equal(result.stable, false);
    assert.equal(result.Lq, Infinity);
    assert.equal(result.Wq, Infinity);
    assert.equal(result.P0, 0);
    assert.ok(result.trafficIntensity >= 1);
  }
});

test('M/M/c/K stays stable even when λ is well above cμ', () => {
  const result = mmck(12, 10, 1, 5);
  assert.equal(result.stable, true);
  assert.ok(result.trafficIntensity > 1);
  assert.ok(result.rho < 1, 'utilization stays below 1');
  assert.ok(result.blockingProbability > 0.2);
});

test('M/M/c/K does not overflow under extreme load and capacity', () => {
  const result = mmck(1000, 1, 1, 200);
  for (const metric of METRICS) assert.ok(Number.isFinite(result[metric]), metric);
  // The system is almost always full: only 1 in 1000 customers can get in.
  assertClose(result.blockingProbability, 0.999, 1e-6);
  assertClose(result.L, 200, 0.01);
});

// ---------------------------------------------------------------------------
// Waiting-time distribution
// ---------------------------------------------------------------------------

test('tail of the waiting-time distribution: P(Wq > 0) = probability of waiting, and its area = Wq', () => {
  // For a non-negative random variable, E[X] = ∫ P(X > t) dt.
  for (const result of [mm1(8, 10), mmc(24, 10, 3), mmck(12, 10, 1, 5), mmck(40, 10, 3, 12)]) {
    assertClose(result.waitTail(0), result.waitProbability, 1e-12, `${result.model} tail at 0`);
    assertClose(integrate(result.waitTail, 40), result.Wq, 1e-6, `${result.model} area under the tail`);
    assert.ok(result.waitTail(1) < result.waitTail(0.5));
  }
});

// ---------------------------------------------------------------------------
// Non-preemptive priority (Cobham)
// ---------------------------------------------------------------------------

test('Cobham on M/M/1: λ = 8, μ = 10, 20% priority customers', () => {
  // W0 = ρ/μ = 0.08;  σ1 = 0.2·0.8 = 0.16
  // Wq priority = 0.08/0.84;  Wq regular = 0.08/(0.84·0.2)
  const [high, regular] = priorityWaits(8, 10, 1, 0.2);
  assertClose(high, 0.08 / 0.84);
  assertClose(regular, 0.08 / (0.84 * 0.2));
});

test('the weighted average of the two classes equals the FIFO Wq (conservation law)', () => {
  for (const [lambda, mu, c] of [
    [8, 10, 1],
    [24, 10, 3],
    [45, 10, 5],
  ]) {
    for (const share of [0.05, 0.2, 0.5, 0.9]) {
      const [high, regular] = priorityWaits(lambda, mu, c, share);
      const blended = share * high + (1 - share) * regular;
      assertClose(blended, mmc(lambda, mu, c).Wq, 1e-12, `c=${c}, share=${share}`);
      assert.ok(high < regular);
    }
  }
});

// ---------------------------------------------------------------------------
// Model selection
// ---------------------------------------------------------------------------

test('analyze picks the model that matches the configuration', () => {
  assert.equal(analyze({ arrivalRate: 8, serviceRate: 10 }).model, 'M/M/1');
  assert.equal(analyze({ arrivalRate: 8, serviceRate: 10, servers: 2 }).model, 'M/M/c');
  assert.equal(
    analyze({ arrivalRate: 8, serviceRate: 10, servers: 2, capacity: 6 }).model,
    'M/M/c/K',
  );
});

test("analyze gives a per-class Wq only when Cobham's formula applies", () => {
  const base = { arrivalRate: 8, serviceRate: 10, priorityShare: 0.2 };
  const priority = { ...base, discipline: DISCIPLINE.PRIORITY };

  assert.equal(analyze({ ...base, discipline: DISCIPLINE.FIFO }).WqByClass, null);
  assert.equal(analyze({ ...priority, capacity: 5 }).WqByClass, null);
  assert.equal(analyze({ ...priority, arrivalRate: 12 }).WqByClass, null);
  assert.deepEqual(analyze(priority).WqByClass, priorityWaits(8, 10, 1, 0.2));
});

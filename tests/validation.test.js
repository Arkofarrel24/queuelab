/**
 * Validation of the simulation engine against the analytic formulas.
 *
 * Two conditions must hold for every metric:
 * 1. The relative difference between the simulation mean and theory is below 2%.
 * 2. The difference is no more than 4 standard errors. This catches a small
 *    but systematic bias that would slip past the first condition.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { analyze } from '../src/analytic/formulas.js';
import { DISCIPLINE } from '../src/sim/engine.js';
import { METRICS, runReplications } from '../src/sim/replications.js';
import { REFERENCE_CASES, RUN_SETTINGS } from './reference-cases.js';

const MAX_RELATIVE_ERROR = 0.02;
const MAX_STANDARD_ERRORS = 4;

for (const { name, config, theory } of REFERENCE_CASES) {
  test(`simulation matches theory: ${name}`, () => {
    const { duration, warmup, replications, seed } = RUN_SETTINGS;
    const { summary } = runReplications({ ...config, duration, warmup, seed }, replications);

    for (const metric of METRICS) {
      const { mean, stdDev, n } = summary[metric];
      const expected = theory[metric];
      const relativeError = Math.abs(mean - expected) / expected;
      const standardErrors = Math.abs(mean - expected) / (stdDev / Math.sqrt(n));

      assert.ok(
        relativeError < MAX_RELATIVE_ERROR,
        `${metric}: theory ${expected}, simulation ${mean}, difference ${(relativeError * 100).toFixed(2)}%`,
      );
      assert.ok(
        standardErrors < MAX_STANDARD_ERRORS,
        `${metric}: theory ${expected}, simulation ${mean}, off by ${standardErrors.toFixed(1)} standard errors`,
      );
    }
  });
}

/**
 * Once the analytic module has passed its tests against textbook examples, it
 * serves as the reference for configurations that have no published answer.
 */
function assertMatches(label, summaryEntry, expected) {
  const { mean, stdDev, n } = summaryEntry;
  const relativeError = Math.abs(mean - expected) / expected;
  const standardErrors = Math.abs(mean - expected) / (stdDev / Math.sqrt(n));
  assert.ok(
    relativeError < MAX_RELATIVE_ERROR && standardErrors < MAX_STANDARD_ERRORS,
    `${label}: theory ${expected}, simulation ${mean} ` +
      `(${(relativeError * 100).toFixed(2)}%, ${standardErrors.toFixed(1)} standard errors)`,
  );
}

const CROSS_CHECKS = [
  { name: 'busy M/M/3', config: { arrivalRate: 24, serviceRate: 10, servers: 3 } },
  { name: 'lightly loaded M/M/5', config: { arrivalRate: 20, serviceRate: 10, servers: 5 } },
  { name: 'overloaded M/M/1/5', config: { arrivalRate: 12, serviceRate: 10, capacity: 5 } },
  {
    name: 'M/M/3/7 emission inspection station',
    config: { arrivalRate: 60, serviceRate: 10, servers: 3, capacity: 7 },
  },
  {
    name: 'M/M/2/2 with no waiting room',
    config: { arrivalRate: 10, serviceRate: 10, servers: 2, capacity: 2 },
  },
];

for (const { name, config } of CROSS_CHECKS) {
  test(`simulation matches the analytic module: ${name}`, () => {
    const { warmup, replications, seed } = RUN_SETTINGS;
    const theory = analyze(config);
    const { summary } = runReplications({ ...config, duration: 4000, warmup, seed }, replications);

    for (const metric of METRICS) {
      // With no waiting room, Lq and Wq are exactly zero in theory and in the simulation.
      if (theory[metric] === 0) assert.equal(summary[metric].mean, 0, metric);
      else assertMatches(metric, summary[metric], theory[metric]);
    }
    if (theory.blockingProbability > 0) {
      assertMatches('rejection probability', summary.rejectionRate, theory.blockingProbability);
    }
  });
}

test("the priority simulation matches Cobham's formula", () => {
  const { warmup, replications, seed } = RUN_SETTINGS;
  for (const config of [
    { arrivalRate: 8, serviceRate: 10, servers: 1, priorityShare: 0.2 },
    { arrivalRate: 24, serviceRate: 10, servers: 3, priorityShare: 0.4 },
  ]) {
    const full = { ...config, discipline: DISCIPLINE.PRIORITY };
    const theory = analyze(full);
    const { summary } = runReplications({ ...full, duration: 6000, warmup, seed }, replications);

    assertMatches(`c=${config.servers} priority Wq`, summary.WqByClass[0], theory.WqByClass[0]);
    assertMatches(`c=${config.servers} regular Wq`, summary.WqByClass[1], theory.WqByClass[1]);
    assertMatches(`c=${config.servers} overall Wq`, summary.Wq, theory.Wq);
  }
});

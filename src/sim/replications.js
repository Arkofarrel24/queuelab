/**
 * Replications and confidence intervals.
 *
 * A single simulation run yields just one random number per metric. To know
 * how far off that number may be, the simulation is repeated several times
 * with different random sequences (the method of independent replications),
 * and the results are summarized as a mean and a confidence interval.
 */

import { DISCIPLINE, QueueSimulation } from './engine.js';

/** The standard queueing metrics summarized across replications. */
export const METRICS = Object.freeze(['rho', 'L', 'Lq', 'W', 'Wq', 'P0']);

// Two-sided 95% critical values of t, that is the 0.975 quantile, for 1-30
// degrees of freedom.
const T_TABLE_95 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
  2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086,
  2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
];
const Z_975 = 1.959964;

/**
 * Critical value t(0.975; df).
 *
 * Above 30 degrees of freedom it uses the Cornish-Fisher expansion, which
 * corrects the normal quantile z into a t quantile:
 *
 *   t ≈ z + (z³ + z) / (4·df) + (5z⁵ + 16z³ + 3z) / (96·df²)
 */
export function tCritical95(df) {
  if (!Number.isInteger(df) || df < 1) return NaN;
  if (df <= T_TABLE_95.length) return T_TABLE_95[df - 1];
  const z = Z_975;
  const z3 = z ** 3;
  const z5 = z ** 5;
  return z + (z3 + z) / (4 * df) + (5 * z5 + 16 * z3 + 3 * z) / (96 * df * df);
}

/**
 * 95% confidence interval for a mean, using Student's t distribution:
 *
 *   x̄ ± t(0.975; n - 1) · s / √n
 *
 * where s is the sample standard deviation (divisor n - 1). The t
 * distribution is used instead of the normal because the population standard
 * deviation is unknown and n is small. The formula requires independent
 * observations; that holds because every replication uses its own random
 * sequence.
 *
 * Non-finite values (for example W in a replication with no customers) are
 * skipped, and `n` reports how many values were actually used.
 */
export function confidenceInterval(values) {
  const finite = values.filter(Number.isFinite);
  const n = finite.length;
  if (n === 0) {
    return { mean: NaN, stdDev: NaN, halfWidth: NaN, lower: NaN, upper: NaN, n };
  }

  const mean = finite.reduce((sum, x) => sum + x, 0) / n;
  if (n === 1) {
    return { mean, stdDev: NaN, halfWidth: NaN, lower: NaN, upper: NaN, n };
  }

  const variance = finite.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (n - 1);
  const stdDev = Math.sqrt(variance);
  const halfWidth = tCritical95(n - 1) * (stdDev / Math.sqrt(n));
  return { mean, stdDev, halfWidth, lower: mean - halfWidth, upper: mean + halfWidth, n };
}

/**
 * Runs several replications of the same configuration.
 *
 * Replication r uses the random sequence (seed, r), so the whole series can
 * be repeated exactly with the same seed.
 *
 * @param {import('./engine.js').SimulationConfig} config
 * @param {number} replications
 * @param {(done: number, total: number) => void} [onProgress] called each time a replication finishes
 * @returns {{ runs: object[], summary: object }}
 */
export function runReplications(config, replications, onProgress) {
  if (!Number.isInteger(replications) || replications < 1) {
    throw new RangeError('Number of replications must be an integer of at least 1.');
  }

  const runs = [];
  for (let r = 0; r < replications; r++) {
    runs.push(new QueueSimulation({ ...config, replication: r }).run());
    onProgress?.(r + 1, replications);
  }

  const summary = {};
  for (const metric of METRICS) {
    summary[metric] = confidenceInterval(runs.map((run) => run[metric]));
  }
  summary.rejectionRate = confidenceInterval(runs.map((run) => run.rejectionRate));
  if (config.discipline === DISCIPLINE.PRIORITY) {
    summary.WqByClass = [0, 1].map((k) => confidenceInterval(runs.map((run) => run.WqByClass[k])));
  }
  return { runs, summary };
}

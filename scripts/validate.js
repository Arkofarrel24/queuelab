/**
 * Prints a comparison of theory and simulation for the reference cases.
 * Run it with: npm run validate
 */

import { METRICS, runReplications } from '../src/sim/replications.js';
import { REFERENCE_CASES, RUN_SETTINGS } from '../tests/reference-cases.js';

const LABELS = { rho: 'ρ', L: 'L', Lq: 'Lq', W: 'W (hours)', Wq: 'Wq (hours)', P0: 'P0' };

const { duration, warmup, replications, seed } = RUN_SETTINGS;
console.log(
  `${replications} replications x ${duration} hours, warm-up ${warmup} hours, seed ${seed}\n`,
);

for (const { name, config, theory } of REFERENCE_CASES) {
  const started = performance.now();
  const { summary } = runReplications({ ...config, duration, warmup, seed }, replications);
  const elapsed = performance.now() - started;

  console.log(name);
  console.log('  Metric       Theory    Simulation (mean ± 95% CI)   Diff      Theory in CI');
  for (const metric of METRICS) {
    const { mean, halfWidth, lower, upper } = summary[metric];
    const expected = theory[metric];
    const difference = ((mean - expected) / expected) * 100;
    const inside = lower <= expected && expected <= upper ? 'yes' : 'no';
    console.log(
      `  ${LABELS[metric].padEnd(11)}  ${expected.toFixed(4).padStart(7)}   ` +
        `${mean.toFixed(4).padStart(7)} ± ${halfWidth.toFixed(4)}`.padEnd(27) +
        `  ${(difference >= 0 ? '+' : '') + difference.toFixed(2)}%`.padEnd(10) +
        `  ${inside}`,
    );
  }
  console.log(`  (${elapsed.toFixed(0)} ms)\n`);
}

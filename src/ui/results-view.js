/**
 * Layer 02, Results: a table that puts the analytic formulas and the
 * simulation side by side, with their difference and where the formula value
 * falls relative to the simulation's confidence interval.
 */

import { DISCIPLINE } from '../sim/engine.js';
import { confidenceInterval } from '../sim/replications.js';
import { h, icon, svg } from './dom.js';
import { formatDifference, formatHours, formatNumber } from './format.js';
import { disciplineLabel, kendallNotation, renderNotice, stabilityNotice } from './model.js';

const MINUTES_PER_HOUR = 60;

/** The six standard queueing metrics. `scale` converts hours to minutes. */
const METRIC_ROWS = [
  { key: 'rho', symbol: 'ρ', name: 'Server utilization', hint: 'share of time servers are busy', digits: 4 },
  { key: 'L', symbol: 'L', name: 'Customers in the system', hint: 'average, waiting + in service', digits: 3 },
  { key: 'Lq', symbol: 'Lq', name: 'Customers in the queue', hint: 'average queue length', digits: 3 },
  { key: 'W', symbol: 'W', name: 'Time in the system', hint: 'waiting + service', digits: 2, scale: MINUTES_PER_HOUR, unit: 'min' },
  { key: 'Wq', symbol: 'Wq', name: 'Time in the queue', hint: 'before service starts', digits: 2, scale: MINUTES_PER_HOUR, unit: 'min' },
  { key: 'P0', symbol: 'P₀', name: 'Chance the system is empty', hint: 'share of time with no customers', digits: 4 },
];

const STATUS = {
  in: { label: 'Inside CI', icon: 'check' },
  out: { label: 'Outside CI', icon: 'alert' },
  na: { label: 'Formula does not apply', icon: 'x' },
};

const elements = {
  empty: () => document.getElementById('results-empty'),
  content: () => document.getElementById('results-content'),
  eyebrow: () => document.getElementById('results-eyebrow'),
  verdict: () => document.getElementById('results-verdict'),
  lead: () => document.getElementById('results-lead'),
  meta: () => document.getElementById('results-meta'),
  banner: () => document.getElementById('results-banner'),
  stale: () => document.getElementById('results-stale'),
  rows: () => document.getElementById('results-rows'),
  extra: () => document.getElementById('results-extra'),
  extraTitle: () => document.getElementById('results-extra-title'),
  extraRows: () => document.getElementById('results-extra-rows'),
  extraNote: () => document.getElementById('results-extra-note'),
};

/** Large numbers do not need many decimals. */
function format(value, digits) {
  const magnitude = Math.abs(value);
  if (magnitude >= 1000) return formatNumber(value, 0);
  if (magnitude >= 100) return formatNumber(value, Math.min(digits, 1));
  return formatNumber(value, digits);
}

function scaleInterval(interval, scale) {
  const { mean, halfWidth, lower, upper } = interval;
  return { mean: mean * scale, halfWidth: halfWidth * scale, lower: lower * scale, upper: upper * scale };
}

/**
 * Compares one formula value with one simulation interval.
 *
 * Difference = (simulation - formula) / formula. The status "inside CI" means
 * the formula value lies between the lower and upper bounds of the 95%
 * confidence interval.
 */
function compare(analytic, interval, formulaApplies) {
  if (!formulaApplies || !Number.isFinite(analytic)) {
    return { difference: NaN, status: 'na' };
  }
  if (!Number.isFinite(interval.mean)) return { difference: NaN, status: 'na' };

  // Formula and simulation are both exactly zero, for example Lq with no waiting room.
  if (analytic === 0 && interval.mean === 0) return { difference: 0, status: 'in' };

  const difference = analytic === 0 ? NaN : (interval.mean - analytic) / analytic;
  const inside = interval.lower <= analytic && analytic <= interval.upper;
  return { difference, status: inside ? 'in' : 'out' };
}

/**
 * A small plot: the band of the simulation's confidence interval, a tick at
 * its mean, and a diamond at the formula value.
 */
function intervalPlot(analytic, interval, showAnalytic) {
  const width = 150;
  const height = 30;
  const pad = 9;
  const middle = height / 2;

  const points = [interval.lower, interval.upper];
  if (showAnalytic) points.push(analytic);
  let low = Math.min(...points);
  let high = Math.max(...points);
  if (high === low) {
    low -= 1;
    high += 1;
  }
  const margin = (high - low) * 0.12;
  low -= margin;
  high += margin;
  const x = (value) => pad + ((value - low) / (high - low)) * (width - 2 * pad);

  const bandStart = x(interval.lower);
  const bandWidth = Math.max(x(interval.upper) - bandStart, 3);
  const children = [
    svg('line', { class: 'ciplot__axis', x1: 0, y1: middle, x2: width, y2: middle }),
    svg('rect', { class: 'ciplot__band', x: bandStart, y: middle - 6, width: bandWidth, height: 12 }),
    svg('rect', { class: 'ciplot__mean', x: x(interval.mean) - 1.5, y: middle - 10, width: 3, height: 20 }),
  ];
  if (showAnalytic) {
    const cx = x(analytic);
    const r = 7;
    children.push(
      svg('polygon', {
        class: 'ciplot__analytic',
        points: `${cx},${middle - r} ${cx + r},${middle} ${cx},${middle + r} ${cx - r},${middle}`,
      }),
    );
  }
  return svg('svg', { class: 'ciplot', viewBox: `0 0 ${width} ${height}`, 'aria-hidden': 'true' }, children);
}

function statusChip(status) {
  const { label, icon: iconName } = STATUS[status];
  return h('span', { class: `status status--${status}` }, [icon(iconName), label]);
}

function valueCell(label, mainText, unit, subText) {
  return h('td', { class: 'num', 'data-label': label }, [
    h('span', { class: 'value' }, [
      mainText,
      unit && h('small', { text: ` ${unit}` }),
      subText && h('span', { class: 'value__ci', text: subText }),
    ]),
  ]);
}

function metricHeader({ symbol, name, hint }) {
  return h('th', { scope: 'row' }, [
    h('div', { class: 'metric' }, [
      h('span', { class: 'metric__symbol', text: symbol, 'aria-hidden': 'true' }),
      h('span', { class: 'metric__name' }, [name, hint && h('small', { text: hint })]),
    ]),
  ]);
}

/**
 * One comparison row.
 *
 * @param {object} row            metric description (symbol, name, digits, unit)
 * @param {number} analytic       formula value, already in display units
 * @param {object} interval       simulation interval, already in display units
 * @param {object} options
 * @param {boolean} options.formulaApplies  false when the formula does not apply
 * @param {string} [options.analyticNote]   small note under the formula value
 * @param {boolean} [options.withPlot]
 */
function compareRow(row, analytic, interval, { formulaApplies, analyticNote, withPlot = true }) {
  const { difference, status } = compare(analytic, interval, formulaApplies);
  const hasSimulation = Number.isFinite(interval.mean);
  const showUnit = (value) => (Number.isFinite(value) ? row.unit : null);

  const cells = [
    metricHeader(row),
    valueCell(
      'Analytic',
      analytic === null ? '—' : format(analytic, row.digits),
      analytic === null ? null : showUnit(analytic),
      analyticNote,
    ),
    valueCell(
      'Simulation',
      format(interval.mean, row.digits),
      showUnit(interval.mean),
      hasSimulation ? `± ${format(interval.halfWidth, row.digits)}` : null,
    ),
    h('td', { class: 'num', 'data-label': 'Difference' }, [
      h('span', { class: 'value', text: formatDifference(difference) }),
    ]),
  ];
  if (withPlot) {
    cells.push(
      h('td', { class: 'position', 'data-label': 'Formula vs. CI' }, [
        h('div', { class: 'position__inner' }, [
          hasSimulation && intervalPlot(analytic, interval, status !== 'na'),
          statusChip(status),
        ]),
      ]),
    );
  }
  return { element: h('tr', {}, cells), status, difference, row };
}

function verdictText(run, rows) {
  const { analytic, config } = run;
  if (!analytic.stable) {
    return {
      title: 'The formulas give up: this system is unstable.',
      lead:
        'With ρ ≥ 1 there is no steady state, so the formulas have no answer. The simulated figures ' +
        `below only describe the first ${formatHours(config.duration)}; the longer the run, the larger they get.`,
    };
  }

  const judged = rows.filter(({ status }) => status !== 'na');
  if (judged.length === 0) {
    return {
      title: 'The simulation produced no data.',
      lead: 'No customers were observed. Lengthen the run or shorten the warm-up.',
    };
  }
  const missed = judged.filter(({ status }) => status === 'out');
  const largest = judged.reduce(
    (worst, item) => (Math.abs(item.difference) > Math.abs(worst.difference) ? item : worst),
    judged[0],
  );
  const largestText = `Largest difference: ${formatDifference(largest.difference)}, on ${largest.row.symbol}.`;

  if (missed.length === 0) {
    return {
      title: 'Formula and simulation agree.',
      lead: `All six formula values fall inside the simulation's 95% confidence interval. ${largestText}`,
    };
  }
  const names = missed.map(({ row }) => row.symbol).join(', ');
  return {
    title: `${missed.length} of ${judged.length} metrics miss the formula.`,
    lead:
      `The formula values for ${names} fall outside the simulation's 95% confidence interval. ${largestText} ` +
      'Likely causes are listed under “How to read this table”.',
  };
}

function disciplineNote(config) {
  if (config.discipline === DISCIPLINE.FIFO) return '';
  const name = config.discipline === DISCIPLINE.LIFO ? 'LIFO' : 'priority';
  return (
    ` The ${name} discipline does not change the averages in this table; what changes is the ` +
    'spread of waiting times, visible in the histogram on the Live layer.'
  );
}

function extraRows(run) {
  const { config, analytic, summary, runs } = run;
  const rows = [];
  let note = '';

  if (config.capacity !== Infinity) {
    rows.push(
      compareRow(
        { symbol: 'Pk', name: 'Chance of rejection', hint: 'system full when the customer arrives', digits: 2, unit: '%' },
        analytic.blockingProbability * 100,
        scaleInterval(summary.rejectionRate, 100),
        { formulaApplies: true, withPlot: false },
      ),
      compareRow(
        { symbol: 'λₑ', name: 'Effective arrival rate', hint: 'customers admitted per hour', digits: 3 },
        analytic.effectiveArrivalRate,
        confidenceInterval(runs.map((item) => item.effectiveArrivalRate)),
        { formulaApplies: true, withPlot: false },
      ),
    );
  }

  if (config.discipline === DISCIPLINE.PRIORITY) {
    const hasFormula = analytic.WqByClass !== null;
    const classes = [
      { symbol: 'Wq¹', name: 'Time in the queue, priority class', digits: 2, unit: 'min' },
      { symbol: 'Wq²', name: 'Time in the queue, regular class', digits: 2, unit: 'min' },
    ];
    classes.forEach((row, k) => {
      rows.push(
        compareRow(
          row,
          hasFormula ? analytic.WqByClass[k] * MINUTES_PER_HOUR : null,
          scaleInterval(summary.WqByClass[k], MINUTES_PER_HOUR),
          { formulaApplies: hasFormula, withPlot: false },
        ),
      );
    });
    note = hasFormula
      ? "The per-class analytic values use Cobham's non-preemptive priority formula. The weighted average " +
        'of the two classes equals the Wq in the main table: priority does not reduce the total waiting ' +
        'time, it only moves it from one class to the other.'
      : "Cobham's formula only holds for a stable, unlimited queue, so here the simulation is the only reference.";
  }
  return { rows, note };
}

/**
 * @param {object | null} run the outcome of one "Run": { config, replications,
 *   analytic, summary, runs, elapsedMs }
 */
export function renderResults(run) {
  elements.empty().hidden = Boolean(run);
  elements.content().hidden = !run;
  if (!run) return;

  const { config, replications, analytic, summary, elapsedMs } = run;

  const rows = METRIC_ROWS.map((row) => {
    const scale = row.scale ?? 1;
    // In an unstable system, the "ρ" in the analytic column is λ/(cμ), not a utilization.
    const analyticNote = row.key === 'rho' && !analytic.stable ? 'λ/(cμ), not a utilization' : null;
    return compareRow(row, analytic[row.key] * scale, scaleInterval(summary[row.key], scale), {
      formulaApplies: analytic.stable,
      analyticNote,
    });
  });
  elements.rows().replaceChildren(...rows.map(({ element }) => element));

  const { title, lead } = verdictText(run, rows);
  elements.eyebrow().textContent = `${kendallNotation(config)} · ${disciplineLabel(config)}`;
  elements.verdict().textContent = title;
  elements.lead().textContent = lead + disciplineNote(config);

  elements.meta().replaceChildren(
    ...[
      kendallNotation(config),
      `${replications} replications`,
      `run length ${formatHours(config.duration)}`,
      `warm-up ${formatHours(config.warmup)}`,
      `seed ${config.seed}`,
      `done in ${formatNumber(elapsedMs / 1000, 2)} s`,
    ].map((text) => h('li', { text })),
  );

  renderNotice(elements.banner(), stabilityNotice(config, analytic));

  const extra = extraRows(run);
  elements.extra().hidden = extra.rows.length === 0;
  elements.extraTitle().textContent =
    config.discipline === DISCIPLINE.PRIORITY && config.capacity === Infinity
      ? 'Waiting time by class'
      : 'More detail';
  elements.extraRows().replaceChildren(...extra.rows.map(({ element }) => element));
  elements.extraNote().textContent = extra.note;
}

/** Marks that the fields have changed since these results were computed. */
export function markResultsStale(stale) {
  elements.stale().hidden = !stale;
}

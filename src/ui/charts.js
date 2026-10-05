/**
 * The two charts on the Live layer, drawn with Chart.js (loaded from a CDN as
 * the global `Chart`).
 *
 * Chart.js's built-in animation is switched off: the data already moves on
 * its own as the simulation advances, and animating every update would only
 * make it stutter.
 */

import { formatNumber } from './format.js';

const MONO = '"Fira Code", ui-monospace, monospace';
const BODY = '"Bricolage Grotesque", system-ui, sans-serif';

export function chartsAvailable() {
  return typeof window.Chart === 'function';
}

function readColors(element) {
  const style = getComputedStyle(element);
  const color = (name) => style.getPropertyValue(name).trim();
  return {
    simulated: color('--color-simulated'),
    analytic: color('--color-analytic'),
    running: color('--lime'),
    text: color('--on-surface'),
    muted: color('--on-surface-muted'),
    surface: color('--surface-raised'),
    warmup: color('--yellow'),
  };
}

function withAlpha(hex, alpha) {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return `rgb(${value >> 16} ${(value >> 8) & 255} ${value & 255} / ${alpha})`;
}

function axis(colors, title, extra = {}) {
  return {
    title: { display: true, text: title, color: colors.muted, font: { family: BODY, size: 13, weight: 600 } },
    ticks: { color: colors.muted, font: { family: MONO, size: 11 }, maxRotation: 0, autoSkipPadding: 12 },
    grid: { color: withAlpha('#f6f4ec', 0.1) },
    border: { color: colors.muted },
    ...extra,
  };
}

function basePlugins(colors) {
  return {
    legend: {
      position: 'bottom',
      align: 'start',
      labels: {
        color: colors.text,
        font: { family: BODY, size: 13, weight: 600 },
        usePointStyle: true,
        boxWidth: 28,
        boxHeight: 8,
        padding: 14,
      },
    },
    tooltip: {
      backgroundColor: '#f6f4ec',
      titleColor: '#0e0e11',
      bodyColor: '#0e0e11',
      titleFont: { family: BODY, weight: 800 },
      bodyFont: { family: MONO },
      cornerRadius: 0,
      padding: 10,
      displayColors: true,
      boxPadding: 4,
    },
  };
}

/** Shades the warm-up period, whose data is not counted. */
const warmupShade = {
  id: 'warmupShade',
  beforeDatasetsDraw(chart, _args, options) {
    if (!(options.until > 0)) return;
    const { ctx, chartArea, scales } = chart;
    const end = Math.min(scales.x.getPixelForValue(options.until), chartArea.right);
    const width = end - chartArea.left;
    if (width <= 0) return;

    ctx.save();
    ctx.fillStyle = withAlpha(options.color, 0.16);
    ctx.fillRect(chartArea.left, chartArea.top, width, chartArea.height);
    ctx.strokeStyle = options.color;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(end, chartArea.top);
    ctx.lineTo(end, chartArea.bottom);
    ctx.stroke();
    if (width > 72) {
      ctx.fillStyle = options.color;
      ctx.font = `700 10px ${MONO}`;
      ctx.textBaseline = 'top';
      ctx.fillText('WARM-UP', chartArea.left + 6, chartArea.top + 6);
    }
    ctx.restore();
  },
};

/**
 * Chart of queue length over simulated time.
 *
 * Three series, told apart by color and line style together:
 * - queue length per time bin (a filled step line),
 * - the running average since the warm-up ended (a thick line),
 * - Lq according to the formula (a dashed line), when the formula applies.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{ warmup: number, analyticLq: number | null }} options
 */
export function createQueueChart(canvas, { warmup, analyticLq }) {
  const colors = readColors(canvas);
  const hasFormula = Number.isFinite(analyticLq);

  const chart = new window.Chart(canvas, {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'Queue length',
          data: [],
          stepped: 'middle',
          fill: 'origin',
          borderColor: colors.simulated,
          backgroundColor: withAlpha(colors.simulated, 0.28),
          borderWidth: 1.5,
          pointRadius: 0,
          pointStyle: 'rect',
          order: 3,
        },
        {
          label: 'Running average (simulated Lq)',
          data: [],
          borderColor: colors.running,
          backgroundColor: colors.running,
          borderWidth: 3,
          pointRadius: 0,
          pointStyle: 'line',
          order: 1,
        },
        {
          label: 'Lq from the formula',
          data: [],
          hidden: !hasFormula,
          borderColor: colors.analytic,
          backgroundColor: colors.analytic,
          borderWidth: 2.5,
          borderDash: [8, 6],
          pointRadius: 0,
          pointStyle: 'line',
          order: 2,
        },
      ],
    },
    options: {
      animation: false,
      parsing: false,
      normalized: true,
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      scales: {
        x: axis(colors, 'Simulated time (hours)', {
          type: 'linear',
          min: 0,
          ticks: {
            color: colors.muted,
            font: { family: MONO, size: 11 },
            maxRotation: 0,
            maxTicksLimit: 7,
            callback: (value) => formatNumber(value, value < 10 && !Number.isInteger(value) ? 1 : 0),
          },
        }),
        y: axis(colors, 'Customers in the queue', { beginAtZero: true }),
      },
      plugins: {
        ...basePlugins(colors),
        warmupShade: { until: warmup, color: colors.warmup },
      },
    },
    plugins: [warmupShade],
  });

  chart.options.plugins.legend.labels.filter = (item) => hasFormula || item.datasetIndex !== 2;
  chart.options.plugins.tooltip.callbacks = {
    title: ([item]) => `Hour ${formatNumber(item.parsed.x, 2)}`,
    label: (item) => ` ${item.dataset.label}: ${formatNumber(item.parsed.y, 2)}`,
  };

  return {
    /**
     * @param {{ from: number, to: number, mean: number, runningMean: number | null }[]} points
     * @param {number} now current simulated time; becomes the right end of the axis
     */
    update(points, now) {
      const [steps, running, formula] = chart.data.datasets;
      steps.data = points.map((point) => ({ x: (point.from + point.to) / 2, y: point.mean }));
      running.data = points
        .filter((point) => point.runningMean !== null)
        .map((point) => ({ x: point.to, y: point.runningMean }));
      const right = Math.max(now, 1e-6);
      formula.data = hasFormula
        ? [
            { x: 0, y: analyticLq },
            { x: right, y: analyticLq },
          ]
        : [];
      chart.options.scales.x.max = right;
      chart.update('none');
    },
    destroy: () => chart.destroy(),
  };
}

/**
 * Waiting-time histogram: bars for the simulation, diamonds for the formula.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{ hasFormula: boolean, formulaLabel: string }} options
 */
export function createWaitChart(canvas, { hasFormula, formulaLabel }) {
  const colors = readColors(canvas);

  const chart = new window.Chart(canvas, {
    type: 'bar',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Simulation',
          data: [],
          backgroundColor: colors.simulated,
          borderColor: colors.text,
          borderWidth: 1.5,
          pointStyle: 'rect',
          categoryPercentage: 0.94,
          barPercentage: 0.94,
          order: 2,
        },
        {
          type: 'line',
          label: formulaLabel,
          data: [],
          hidden: !hasFormula,
          showLine: false,
          backgroundColor: colors.analytic,
          borderColor: colors.text,
          pointStyle: 'rectRot',
          pointRadius: 6,
          pointHoverRadius: 8,
          pointBorderWidth: 2,
          order: 1,
        },
      ],
    },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: axis(colors, 'Waiting time (minutes)', { grid: { display: false } }),
        y: axis(colors, 'Share of customers', {
          beginAtZero: true,
          ticks: {
            color: colors.muted,
            font: { family: MONO, size: 11 },
            callback: (value) => `${formatNumber(value, 0)}%`,
          },
        }),
      },
      plugins: basePlugins(colors),
    },
  });

  chart.options.plugins.legend.labels.filter = (item) => hasFormula || item.datasetIndex !== 1;
  chart.options.plugins.tooltip.callbacks = {
    title: ([item]) => `Waited ${item.label} min`,
    label: (item) => ` ${item.dataset.label}: ${formatNumber(item.parsed.y, 1)}%`,
  };

  return {
    /**
     * @param {string[]} labels
     * @param {number[]} simulated percentage of customers per bar
     * @param {number[]} formula   percentage according to the formula, per bar
     */
    update(labels, simulated, formula) {
      chart.data.labels = labels;
      chart.data.datasets[0].data = simulated;
      chart.data.datasets[1].data = hasFormula ? formula : [];
      chart.update('none');
    },
    destroy: () => chart.destroy(),
  };
}

/**
 * Layer 03, Live: runs one replication in front of your eyes.
 *
 * What runs here is the same simulation engine the Results layer uses, with
 * the same seed and replication index as the first replication. The only
 * difference is its pace: the engine is advanced event by event in step with
 * the wall clock, and its state is drawn as it goes.
 */

import { ARRIVAL_OUTCOME, DISCIPLINE, QueueSimulation } from '../sim/engine.js';
import { BinnedSeries } from '../stats/binned-series.js';
import { niceFloor, WaitHistogram } from '../stats/wait-histogram.js';
import { chartsAvailable, createQueueChart, createWaitChart } from './charts.js';
import { h } from './dom.js';
import {
  formatAdaptive,
  formatClock,
  formatHours,
  formatInteger,
  formatNumber,
  formatPercent,
  pluralize,
} from './format.js';
import { disciplineLabel, kendallNotation } from './model.js';
import { QueueCanvas } from './queue-canvas.js';

const MINUTES_PER_HOUR = 60;
/** Maximum work time per frame, so the animation stays at 60 fps. */
const FRAME_BUDGET_MS = 10;
/** Above this many events per frame, tokens are no longer animated one by one. */
const SNAP_THRESHOLD = 6;
const STATS_INTERVAL_MS = 120;
const CHART_INTERVAL_MS = 300;
/** Speed: arrivals per second, from slowest to fastest. */
const SLOWEST = 0.5;
const SPEED_RANGE = 400;

const PHASE = {
  warmup: 'Warm-up',
  observing: 'Observing',
  done: 'Done',
};

export function createLiveView() {
  const element = (id) => document.getElementById(id);
  const content = element('live-content');
  const empty = element('live-empty');
  const playButton = element('live-play');
  const playIcon = element('live-play-icon');
  const playLabel = element('live-play-label');
  const speedInput = element('live-speed');
  const speedOutput = element('live-speed-out');
  const statsList = element('live-stats');
  const announce = element('live-announce');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const canvas = new QueueCanvas(element('live-canvas'));

  let run = null;
  let simulation = null;
  let series = null;
  let histogram = null;
  let queueChart = null;
  let waitChart = null;
  let stats = {};

  let active = false;
  let playing = false;
  let fastForward = false;
  let autoPlay = false;
  let visualClock = 0;
  let longestQueue = 0;
  let phase = null;
  let frameId = null;
  let lastFrame = 0;
  let lastStats = 0;
  let lastCharts = 0;
  let chartsDirty = false;

  // --- Speed ------------------------------------------------------------------

  /** The slider position 0-100 maps exponentially to arrivals per second. */
  function arrivalsPerSecond() {
    return SLOWEST * SPEED_RANGE ** (speedInput.valueAsNumber / 100);
  }

  function renderSpeed() {
    if (!run) return;
    const rate = arrivalsPerSecond();
    const minutesPerSecond = (rate / run.config.arrivalRate) * MINUTES_PER_HOUR;
    const simulated =
      minutesPerSecond >= 90
        ? `${formatNumber(minutesPerSecond / MINUTES_PER_HOUR, 1)} hours`
        : `${formatNumber(minutesPerSecond, minutesPerSecond < 10 ? 1 : 0)} minutes`;
    speedOutput.textContent =
      `≈ ${formatNumber(rate, rate < 10 ? 1 : 0)} arrivals per second · 1 second = ${simulated} simulated`;
  }

  // --- Setting up one showing ---------------------------------------------------

  function reset() {
    const { config } = run;
    // Histogram bin: a fraction of the combined mean service time, rounded to
    // a number of minutes that reads well.
    const resolution = niceFloor(MINUTES_PER_HOUR / (config.servers * config.serviceRate) / 4);
    histogram = new WaitHistogram(resolution);
    simulation = new QueueSimulation({
      ...config,
      replication: 0,
      onWait: (wait) => histogram.add(wait * MINUTES_PER_HOUR),
    });
    series = new BinnedSeries({
      binWidth: 0.5 / config.arrivalRate,
      maxBins: 360,
      averageFrom: config.warmup,
    });

    visualClock = 0;
    longestQueue = 0;
    fastForward = false;
    phase = null;
    chartsDirty = true;
    canvas.clear();
    canvas.sync(simulation, false);
    renderEverything();
  }

  function buildCharts() {
    queueChart?.destroy();
    waitChart?.destroy();
    queueChart = null;
    waitChart = null;

    const available = chartsAvailable();
    for (const fallback of content.querySelectorAll('.chart-card__fallback')) {
      fallback.hidden = available;
      fallback.previousElementSibling.hidden = !available;
    }
    if (!available) return;

    const { config, analytic } = run;
    queueChart = createQueueChart(element('chart-queue'), {
      warmup: config.warmup,
      analyticLq: analytic.stable ? analytic.Lq : null,
    });
    waitChart = createWaitChart(element('chart-wait'), {
      hasFormula: analytic.stable,
      formulaLabel:
        config.discipline === DISCIPLINE.FIFO ? 'Formula' : 'FIFO formula (for reference)',
    });
  }

  function buildStats() {
    const { config } = run;
    const tiles = [
      ['inSystem', 'In the system'],
      ['inQueue', 'In the queue'],
      ['served', 'Served'],
      config.capacity !== Infinity && ['rejected', 'Turned away'],
      ['Lq', 'Lq so far', true],
      ['Wq', 'Wq so far', true],
      ['rho', 'Utilization so far', true],
    ].filter(Boolean);

    stats = {};
    statsList.replaceChildren(
      ...tiles.map(([key, label, accent]) => {
        const value = h('span', { text: '—' });
        const note = h('small');
        stats[key] = { value, note };
        return h('div', { class: accent ? 'stat stat--accent' : 'stat' }, [
          h('dt', { text: label }),
          h('dd', {}, [value, note]),
        ]);
      }),
    );
  }

  // --- Advancing the simulation ---------------------------------------------------

  /**
   * Processes every event that falls before the target time, within a work
   * budget per frame.
   *
   * @returns {number} the number of events processed
   */
  function advance(dt) {
    const target = fastForward
      ? Infinity
      : visualClock + (dt * arrivalsPerSecond()) / run.config.arrivalRate;
    const deadline = performance.now() + FRAME_BUDGET_MS;
    const rejected = [];
    let processed = 0;
    let outOfTime = false;

    while (!simulation.finished && simulation.fel.peek().time <= target) {
      const from = simulation.clock;
      const queueBefore = simulation.queueLength;
      const event = simulation.step();
      // Over (from, clock) the queue length still equals queueBefore.
      series.add(from, simulation.clock, queueBefore);
      if (simulation.queueLength > longestQueue) longestQueue = simulation.queueLength;
      if (event.outcome === ARRIVAL_OUTCOME.REJECTED) rejected.push(event.customer);

      processed++;
      if ((processed & 127) === 0 && performance.now() > deadline) {
        outOfTime = true;
        break;
      }
    }

    // When the work budget runs out, the displayed clock falls behind and follows the engine.
    visualClock =
      simulation.finished || outOfTime || fastForward
        ? simulation.clock
        : Math.min(target, run.config.duration);

    const animate = !reducedMotion.matches && !fastForward && processed <= SNAP_THRESHOLD;
    if (processed > 0) {
      canvas.sync(simulation, animate);
      if (animate) rejected.forEach((customer) => canvas.reject(customer));
      chartsDirty = true;
    }
    return processed;
  }

  function frame(now) {
    frameId = requestAnimationFrame(frame);
    const dt = Math.min((now - lastFrame) / 1000, 0.1);
    lastFrame = now;

    if (playing && !simulation.finished) advance(dt);
    canvas.draw(dt, visualClock);

    if (now - lastStats > STATS_INTERVAL_MS) {
      lastStats = now;
      renderClock();
      renderStats();
    }
    if (chartsDirty && now - lastCharts > CHART_INTERVAL_MS) {
      lastCharts = now;
      renderCharts();
    }
    if (simulation.finished && playing) {
      setPlaying(false);
      renderEverything();
    }
  }

  function startLoop() {
    if (frameId !== null || !run) return;
    lastFrame = performance.now();
    frameId = requestAnimationFrame(frame);
  }

  function stopLoop() {
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null;
  }

  function setPlaying(next) {
    playing = next;
    if (!next) fastForward = false;
    playButton.setAttribute('aria-pressed', String(next));
    playIcon.setAttribute('href', next ? '#i-pause' : '#i-play');
    if (next) playLabel.textContent = 'Pause';
    else playLabel.textContent = simulation?.finished ? 'Replay' : 'Play';
  }

  // --- Rendering ------------------------------------------------------------------

  function renderClock() {
    const { config } = run;
    element('live-clock').textContent = formatClock(visualClock);
    element('live-progress').style.setProperty('--done', String(visualClock / config.duration));

    let next = 'observing';
    if (simulation.finished) next = 'done';
    else if (!simulation.warmedUp) next = 'warmup';
    if (next === phase) return;

    const previous = phase;
    phase = next;
    const badge = element('live-phase');
    badge.textContent = PHASE[next];
    badge.dataset.phase = next;
    if (next === 'observing' && previous === 'warmup') {
      announce.textContent = 'Warm-up finished. Statistics are counted from now on.';
    } else if (next === 'done') {
      const { Lq, Wq } = simulation.results;
      announce.textContent =
        `Simulation finished. On average ${formatAdaptive(Lq)} customers were in the queue, ` +
        `and the average wait was ${formatAdaptive(Wq * MINUTES_PER_HOUR)} minutes.`;
    }
  }

  function renderStats() {
    const { analytic } = run;
    const results = simulation.results;
    const hasData = results.observedTime > 0;
    const formula = (text) => (analytic.stable ? `formula: ${text}` : 'formula does not apply');
    const set = (key, value, note = '') => {
      if (!stats[key]) return;
      stats[key].value.textContent = value;
      stats[key].note.textContent = note;
    };

    set('inSystem', formatInteger(simulation.numberInSystem));
    set('inQueue', formatInteger(simulation.queueLength), `longest ${formatInteger(longestQueue)}`);
    set('served', formatInteger(results.served));
    set(
      'rejected',
      formatInteger(results.rejected),
      results.arrivals > 0 ? `${formatPercent(results.rejectionRate)} of arrivals` : '',
    );
    set('Lq', hasData ? formatAdaptive(results.Lq) : '—', formula(formatAdaptive(analytic.Lq)));
    set(
      'Wq',
      Number.isFinite(results.Wq) ? `${formatAdaptive(results.Wq * MINUTES_PER_HOUR)} min` : '—',
      formula(`${formatAdaptive(analytic.Wq * MINUTES_PER_HOUR)} min`),
    );
    set('rho', hasData ? formatNumber(results.rho, 3) : '—', formula(formatNumber(analytic.rho, 3)));
  }

  function binWidthText(hours) {
    const minutes = hours * MINUTES_PER_HOUR;
    if (minutes < 1) return `${formatNumber(minutes * 60, 0)} seconds`;
    if (minutes < 90) return `${formatNumber(minutes, minutes < 10 ? 1 : 0)} minutes`;
    return `${formatNumber(hours, Number.isInteger(hours) ? 0 : 1)} hours`;
  }

  function histogramLabel(from, to, width) {
    let digits = 0;
    if (width < 0.1) digits = 2;
    else if (width < 1) digits = 1;
    return `${formatNumber(from, digits)}–${formatNumber(to, digits)}`;
  }

  function renderCharts() {
    chartsDirty = false;
    const { analytic, config } = run;
    const results = simulation.results;

    // Queue length over time
    const points = series.points();
    queueChart?.update(points, visualClock);
    element('chart-queue-sub').textContent =
      `Each step is the average over ${binWidthText(series.binWidth)}. ` +
      'The green line is the running average since the warm-up ended.';
    element('chart-queue-summary').textContent =
      `Up to ${formatClock(visualClock)}: the longest queue was ${pluralize(longestQueue, 'customer')}` +
      (simulation.warmedUp && results.observedTime > 0
        ? `, and the average since the warm-up is ${formatAdaptive(results.Lq)}.`
        : '. Still warming up.');

    // Waiting-time distribution
    const { zeroShare, bars, overflow, width } = histogram.bars();
    const tail = (minutes) => analytic.waitTail(minutes / MINUTES_PER_HOUR);
    const rows = [
      { label: '0', simulated: zeroShare, formula: 1 - tail(0) },
      ...bars.map((bar) => ({
        label: histogramLabel(bar.from, bar.to, width),
        simulated: bar.share,
        formula: tail(bar.from) - tail(bar.to),
      })),
      { label: `> ${formatNumber(overflow.from, width < 1 ? 1 : 0)}`, simulated: overflow.share, formula: tail(overflow.from) },
    ];
    waitChart?.update(
      rows.map((row) => row.label),
      rows.map((row) => row.simulated * 100),
      rows.map((row) => row.formula * 100),
    );

    let note = "The blue diamonds are the formula's prediction.";
    if (!analytic.stable) note = 'The system is unstable, so the formula has no prediction.';
    else if (config.discipline !== DISCIPLINE.FIFO) {
      const name = config.discipline === DISCIPLINE.LIFO ? 'LIFO' : 'priority';
      note =
        "The blue diamonds are the formula's prediction for FIFO: the average is the same, but the " +
        `spread differs under the ${name} discipline.`;
    }
    element('chart-wait-sub').textContent =
      `Share of customers by how long they waited, counted after the warm-up. ${note}`;
    element('chart-wait-summary').textContent =
      histogram.total > 0
        ? `${pluralize(histogram.total, 'customer')} observed. ${formatPercent(zeroShare)} were served at once; ` +
          `the average wait was ${formatAdaptive(histogram.mean)} minutes.`
        : 'No customers observed yet.';
    element('chart-wait-rows').replaceChildren(
      ...rows.map((row) =>
        h('tr', {}, [
          h('th', { scope: 'row', text: row.label }),
          h('td', { class: 'num', text: formatPercent(row.simulated) }),
          h('td', { class: 'num', text: analytic.stable ? formatPercent(row.formula) : '—' }),
        ]),
      ),
    );
  }

  function renderEverything() {
    renderClock();
    renderStats();
    renderCharts();
    canvas.draw(0, visualClock);
  }

  // --- Buttons ----------------------------------------------------------------------

  playButton.addEventListener('click', () => {
    if (simulation.finished) reset();
    setPlaying(!playing);
  });

  element('live-restart').addEventListener('click', () => {
    const wasPlaying = playing && !simulation.finished;
    reset();
    setPlaying(wasPlaying);
  });

  element('live-skip').addEventListener('click', () => {
    if (simulation.finished) return;
    fastForward = true;
    setPlaying(true);
  });

  speedInput.addEventListener('input', renderSpeed);

  new ResizeObserver(() => {
    if (!run || !active) return;
    canvas.resize();
    canvas.sync(simulation, false);
    canvas.draw(0, visualClock);
  }).observe(element('live-canvas').parentElement);

  return {
    /** Loads the outcome of a new "Run"; the showing starts when the Live layer opens. */
    load(nextRun) {
      run = nextRun;
      empty.hidden = true;
      content.hidden = false;

      const { config, replications } = run;
      element('live-eyebrow').textContent = `${kendallNotation(config)} · ${disciplineLabel(config)}`;
      element('live-of').textContent = `of ${formatHours(config.duration)}`;
      element('legend-priority').hidden = config.discipline !== DISCIPLINE.PRIORITY;
      element('legend-rejected').hidden = config.capacity === Infinity;
      element('live-note').textContent =
        `This animation replays the first replication (seed ${config.seed}). The table on the Results ` +
        `layer summarizes all ${replications} replications, so the numbers here will differ slightly.`;

      canvas.configure({ servers: config.servers, capacity: config.capacity });
      buildStats();
      buildCharts();
      setPlaying(false);
      reset();
      renderSpeed();
      autoPlay = true;
      if (active) this.activate();
    },

    /** Called when the Live layer becomes the top layer. */
    activate() {
      active = true;
      if (!run) return;
      canvas.resize();
      canvas.sync(simulation, false);
      startLoop();
      // Play automatically once per new result, unless the user asked for reduced motion.
      if (autoPlay && !reducedMotion.matches) setPlaying(true);
      autoPlay = false;
    },

    /** Called when the user moves to another layer: the showing is paused. */
    deactivate() {
      active = false;
      if (!run) return;
      setPlaying(false);
      stopLoop();
    },

    markStale(stale) {
      element('live-stale').hidden = !stale;
    },
  };
}

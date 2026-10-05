/**
 * Layer 01, Setup: reads and validates the fields, applies the quick
 * examples, and refreshes the summary ticket whenever a field changes.
 */

import { analyze } from '../analytic/formulas.js';
import { DISCIPLINE } from '../sim/engine.js';
import { h, icon } from './dom.js';
import { formatAdaptive, formatCount, formatInteger, formatNumber, formatPercent } from './format.js';
import {
  describeCapacity,
  disciplineLabel,
  kendallNotation,
  loadLevel,
  renderNotice,
  stabilityNotice,
} from './model.js';

const MAX_SEED = 4294967295;
/** Workload limit: the number of customers simulated across all replications. */
const MAX_CUSTOMERS = 60e6;
/** Limit on the queue backlog of an unstable system, so memory does not run out. */
const MAX_BACKLOG = 3e6;
/** The ρ gauge is drawn up to this value; ρ = 1 falls at 80% of its width. */
const GAUGE_MAX = 1.25;

const NUMBER_FIELDS = [
  { key: 'arrivalRate', id: 'lambda', min: 0.01, max: 1000 },
  { key: 'serviceRate', id: 'mu', min: 0.01, max: 1000 },
  { key: 'priorityShare', id: 'share', min: 1, max: 99 },
  { key: 'capacity', id: 'capacity', min: 1, max: 200, integer: true },
  { key: 'duration', id: 'duration', min: 1, max: 100000 },
  { key: 'warmup', id: 'warmup', min: 0, max: 100000 },
  { key: 'replications', id: 'replications', min: 2, max: 200, integer: true },
  { key: 'seed', id: 'seed', min: 0, max: MAX_SEED, integer: true },
];

/** The fields that define the queueing system (as opposed to simulation settings). */
const SYSTEM_FIELDS = ['lambda', 'mu', 'share', 'capacity'];

const PRESETS = {
  single: { lambda: 8, mu: 10, servers: 1, discipline: DISCIPLINE.FIFO, limited: false },
  triple: { lambda: 24, mu: 10, servers: 3, discipline: DISCIPLINE.FIFO, limited: false },
  saturated: { lambda: 9.7, mu: 10, servers: 1, discipline: DISCIPLINE.FIFO, limited: false },
  unstable: { lambda: 12, mu: 10, servers: 1, discipline: DISCIPLINE.FIFO, limited: false },
  limited: { lambda: 12, mu: 10, servers: 1, discipline: DISCIPLINE.FIFO, limited: true, capacity: 5 },
  priority: { lambda: 8, mu: 10, servers: 1, discipline: DISCIPLINE.PRIORITY, share: 20, limited: false },
};

const STATE_TEXT = {
  calm: 'Stable',
  busy: 'Stable, but busy',
  unstable: 'Unstable',
  capped: 'Overloaded, held back by the capacity limit',
};

/**
 * @param {object} handlers
 * @param {() => void} handlers.onChange  called whenever a field changes
 * @param {(system: object) => void} handlers.onSystem
 *   called whenever the queueing system (λ, μ, c, discipline, K) changes and is valid
 * @param {(config: object, replications: number) => void} handlers.onSubmit
 */
export function createForm({ onChange, onSystem, onSubmit }) {
  const form = document.getElementById('setup-form');
  const inputs = Object.fromEntries(
    NUMBER_FIELDS.map(({ id }) => [id, document.getElementById(`f-${id}`)]),
  );
  const errorElements = Object.fromEntries(
    NUMBER_FIELDS.map(({ id }) => [id, document.getElementById(`e-${id}`)]),
  );
  const wrapShare = document.getElementById('wrap-share');
  const wrapCapacity = document.getElementById('wrap-capacity');
  const presetButtons = [...document.querySelectorAll('[data-preset]')];

  const runButton = document.getElementById('btn-run');
  const runLabel = document.getElementById('btn-run-label');
  const cancelButton = document.getElementById('btn-cancel');
  const progress = document.getElementById('run-progress');
  const progressBar = document.getElementById('run-progress-bar');
  const runError = document.getElementById('run-error');
  const barModel = document.getElementById('bar-model');
  const barWork = document.getElementById('bar-work');

  /** Fields the user has already left; only these may show an error. */
  const touched = new Set();
  let busy = false;
  let lastSystemKey = null;

  const radio = (name) => form.elements[name].value;
  const isLimited = () => radio('capacityMode') === 'limited';
  const isPriority = () => radio('discipline') === DISCIPLINE.PRIORITY;

  function isActive(id) {
    if (id === 'share') return isPriority();
    if (id === 'capacity') return isLimited();
    return true;
  }

  function readNumber({ id, min, max, integer }) {
    const input = inputs[id];
    const value = input.valueAsNumber;
    if (input.value.trim() === '' || Number.isNaN(value)) {
      return { error: 'Enter a number.' };
    }
    if (integer && !Number.isInteger(value)) {
      return { error: 'Must be a whole number, no decimals.' };
    }
    if (value < min || value > max) {
      return { error: `Enter a number from ${formatLimit(min)} to ${formatLimit(max)}.` };
    }
    return { value };
  }

  /**
   * Reads every field.
   *
   * @returns {{
   *   errors: Record<string, string>,
   *   system: object | null,   the queueing system configuration, or null when not valid yet
   *   config: object | null,   the full simulation configuration, or null when not valid yet
   *   replications: number,
   * }}
   */
  function read() {
    const errors = {};
    const values = {};
    for (const spec of NUMBER_FIELDS) {
      if (!isActive(spec.id)) continue;
      const { value, error } = readNumber(spec);
      if (error) errors[spec.id] = error;
      else values[spec.key] = value;
    }

    const servers = Number(radio('servers'));
    const discipline = radio('discipline');

    if (isLimited() && !errors.capacity && values.capacity < servers) {
      errors.capacity = `Capacity must be at least the number of servers (${servers}), because customers in service count too.`;
    }
    if (!errors.warmup && !errors.duration && values.warmup >= values.duration) {
      errors.warmup = `Must be shorter than the run length (${formatInteger(values.duration)} hours), so there is still data left to observe.`;
    }

    const systemValid = SYSTEM_FIELDS.every((id) => !errors[id]);
    const system = systemValid
      ? {
          arrivalRate: values.arrivalRate,
          serviceRate: values.serviceRate,
          servers,
          discipline,
          priorityShare: isPriority() ? values.priorityShare / 100 : 0.2,
          capacity: isLimited() ? values.capacity : Infinity,
        }
      : null;

    // Workload check, only once all the basic numbers are valid.
    if (system && !errors.duration && !errors.replications) {
      const customers = system.arrivalRate * values.duration * values.replications;
      const backlog =
        system.capacity === Infinity
          ? (system.arrivalRate - servers * system.serviceRate) * values.duration
          : 0;
      if (backlog > MAX_BACKLOG) {
        const longest = Math.floor(MAX_BACKLOG / (system.arrivalRate - servers * system.serviceRate));
        errors.duration =
          `This system is unstable, so about ${formatCount(backlog)} customers would pile up in the queue. ` +
          `Shorten the run to at most ${formatInteger(longest)} hours.`;
      } else if (customers > MAX_CUSTOMERS) {
        errors.duration =
          `Too heavy: about ${formatCount(customers)} customers would have to be simulated. ` +
          `Reduce the run length or the number of replications to get below ${formatCount(MAX_CUSTOMERS)}.`;
      }
    }

    const valid = Object.keys(errors).length === 0;
    return {
      errors,
      system,
      config: valid
        ? { ...system, duration: values.duration, warmup: values.warmup, seed: values.seed }
        : null,
      replications: values.replications,
    };
  }

  function showErrors(errors) {
    for (const { id } of NUMBER_FIELDS) {
      const message = touched.has(id) && isActive(id) ? (errors[id] ?? '') : '';
      inputs[id].setAttribute('aria-invalid', message ? 'true' : 'false');
      if (errorElements[id].textContent !== message) errorElements[id].textContent = message;
    }
  }

  function refresh() {
    wrapShare.hidden = !isPriority();
    wrapCapacity.hidden = !isLimited();

    const state = read();
    showErrors(state.errors);
    renderTicket(state.system, inputs.seed.value);

    if (state.system) {
      // JSON writes Infinity as null, which still differs from any number K.
      const key = JSON.stringify(state.system);
      if (key !== lastSystemKey) {
        lastSystemKey = key;
        onSystem(state.system);
      }
      const rho = analyze(state.system).trafficIntensity;
      const unstable = rho >= 1 && state.system.capacity === Infinity;
      barModel.textContent =
        `${kendallNotation(state.system)} · ρ ${formatNumber(rho, 3)}` +
        (unstable ? ' · unstable' : '');
    } else {
      barModel.textContent = 'Some fields need attention';
    }
    if (!busy) {
      barWork.textContent = state.config
        ? `≈ ${formatCount(state.config.arrivalRate * state.config.duration * state.replications)} customers will be simulated`
        : 'Check the fields marked in red';
    }
    return state;
  }

  function applyPreset(name) {
    const preset = PRESETS[name];
    inputs.lambda.value = preset.lambda;
    inputs.mu.value = preset.mu;
    form.elements.servers.value = String(preset.servers);
    form.elements.discipline.value = preset.discipline;
    form.elements.capacityMode.value = preset.limited ? 'limited' : 'unlimited';
    if (preset.share) inputs.share.value = preset.share;
    if (preset.capacity) inputs.capacity.value = preset.capacity;
    for (const button of presetButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.preset === name));
    }
    refresh();
    onChange();
  }

  // --- Events ---------------------------------------------------------------

  form.addEventListener('input', (event) => {
    // Changing a system parameter means the quick example no longer applies.
    if (event.target.name !== 'seed') {
      for (const button of presetButtons) button.setAttribute('aria-pressed', 'false');
    }
    if (event.target.name === 'capacityMode' && isLimited()) {
      // The K field has just appeared; make sure it starts with a sensible
      // value and that its error is visible.
      const servers = Number(radio('servers'));
      if (!(inputs.capacity.valueAsNumber >= servers)) inputs.capacity.value = servers + 4;
      touched.add('capacity');
    }
    if (event.target.name === 'servers') touched.add('capacity');
    refresh();
    onChange();
  });

  form.addEventListener('focusout', (event) => {
    const spec = NUMBER_FIELDS.find(({ id }) => inputs[id] === event.target);
    if (!spec) return;
    touched.add(spec.id);
    if (spec.id === 'duration') touched.add('warmup');
    refresh();
  });

  for (const button of presetButtons) {
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => applyPreset(button.dataset.preset));
  }

  document.getElementById('btn-seed').addEventListener('click', () => {
    inputs.seed.value = Math.floor(Math.random() * 1_000_000);
    refresh();
    onChange();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy) return;
    for (const { id } of NUMBER_FIELDS) touched.add(id);
    const state = refresh();
    if (!state.config) {
      const firstInvalid = NUMBER_FIELDS.find(({ id }) => state.errors[id] && isActive(id));
      inputs[firstInvalid.id].focus();
      return;
    }
    runError.textContent = '';
    onSubmit(state.config, state.replications);
  });

  refresh();

  return {
    /** Switches the action bar's appearance while a simulation is running. */
    setBusy(isBusy) {
      busy = isBusy;
      runButton.disabled = isBusy;
      runButton.setAttribute('aria-busy', String(isBusy));
      runLabel.textContent = isBusy ? 'Running' : 'Run simulation';
      cancelButton.hidden = !isBusy;
      progress.hidden = !isBusy;
      progressBar.style.setProperty('--done', '0');
      if (!isBusy) refresh();
    },
    setProgress(done, total) {
      progressBar.style.setProperty('--done', String(done / total));
      barWork.textContent = `Replication ${done} of ${total} done`;
    },
    showRunError(message) {
      runError.textContent = message;
    },
    onCancel(handler) {
      cancelButton.addEventListener('click', handler);
    },
  };
}

function formatLimit(value) {
  return Number.isInteger(value) ? formatInteger(value) : formatNumber(value, 2);
}

// ---------------------------------------------------------------------------
// Summary ticket
// ---------------------------------------------------------------------------

const ticket = {
  model: () => document.getElementById('ticket-model'),
  sub: () => document.getElementById('ticket-sub'),
  rho: () => document.getElementById('ticket-rho'),
  fill: () => document.getElementById('ticket-rho-fill'),
  state: () => document.getElementById('ticket-state'),
  banner: () => document.getElementById('ticket-banner'),
  metrics: () => document.getElementById('ticket-metrics'),
  barcode: () => document.getElementById('ticket-barcode'),
  seed: () => document.getElementById('ticket-seed'),
};

function renderTicket(system, seedText) {
  renderBarcode(seedText);
  ticket.seed().textContent = seedText || '—';

  if (!system) {
    ticket.model().textContent = 'M/M/?';
    ticket.sub().textContent = 'Complete the fields marked in red';
    ticket.rho().textContent = '—';
    ticket.fill().style.setProperty('--fill', '0');
    ticket.state().replaceChildren();
    ticket.metrics().replaceChildren();
    renderNotice(ticket.banner(), null);
    return;
  }

  const analytic = analyze(system);
  const rho = analytic.trafficIntensity;
  let level = loadLevel(rho);
  const fill = ticket.fill();
  fill.style.setProperty('--fill', String(Math.min(rho / GAUGE_MAX, 1)));
  fill.dataset.level = level;
  if (level === 'unstable' && system.capacity !== Infinity) level = 'capped';

  ticket.model().textContent = kendallNotation(system);
  ticket.sub().textContent = `${disciplineLabel(system)} · ${describeCapacity(system)}`;
  ticket.rho().textContent = formatNumber(rho, 3);
  ticket.state().replaceChildren(
    icon(level === 'calm' || level === 'busy' ? 'check' : 'alert'),
    STATE_TEXT[level],
  );
  renderNotice(ticket.banner(), stabilityNotice(system, analytic));

  const minutes = (hours) => [formatAdaptive(hours * 60), 'min'];
  const rows = [
    ['L', 'in the system', [formatAdaptive(analytic.L)]],
    ['Lq', 'in the queue', [formatAdaptive(analytic.Lq)]],
    ['W', 'time in system', minutes(analytic.W)],
    ['Wq', 'time in queue', minutes(analytic.Wq)],
    ['P0', 'chance it is empty', [formatNumber(analytic.P0, 4)]],
  ];
  if (system.capacity !== Infinity) {
    rows.push(['Pk', 'chance of rejection', [formatPercent(analytic.blockingProbability)]]);
  } else {
    rows.push(['C', 'chance of waiting', [formatPercent(analytic.waitProbability)]]);
  }

  ticket.metrics().replaceChildren(
    ...rows.map(([symbol, name, [value, unit]]) =>
      h('div', {}, [
        h('dt', {}, [h('b', { text: symbol }), name]),
        h('dd', {}, [value, unit && value !== '∞' && h('small', { text: ` ${unit}` })]),
      ]),
    ),
  );
}

/** Decoration: barcode-like stripes whose pattern is determined by the seed. */
function renderBarcode(seedText) {
  let state = (Number(seedText) || 0) >>> 0;
  const bars = [];
  for (let i = 0; i < 48; i++) {
    // A simple linear congruential generator; good enough for decoration.
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const width = 1 + (state >>> 30);
    const gap = 1 + ((state >>> 27) & 3);
    bars.push(h('i', { style: `width:${width}px;margin-right:${gap}px` }));
  }
  ticket.barcode().replaceChildren(...bars);
}

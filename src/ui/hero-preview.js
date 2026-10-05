/**
 * The live preview at the top of the Setup layer.
 *
 * This small stage runs the real simulation engine, endlessly, on the
 * parameters currently entered. So it is more than decoration: raising λ
 * makes people arrive closer together, adding servers shortens the line, and
 * an unstable system visibly piles up.
 *
 * What it shows is not a result. No statistics are computed here; the
 * official numbers still come from the "Run simulation" button.
 */

import { analyze } from '../analytic/formulas.js';
import { ARRIVAL_OUTCOME, QueueSimulation } from '../sim/engine.js';
import { formatNumber } from './format.js';
import { kendallNotation } from './model.js';
import { QueueCanvas } from './queue-canvas.js';

/** Playback speed: how many arrivals per second, whatever λ is. */
const ARRIVALS_PER_SECOND = 2.2;
/** The engine requires a run length; this figure practically means "never ends". */
const ENDLESS_HOURS = 1e12;
/** Before showing, the simulation is advanced this far so the stage is not empty. */
const HEAD_START_ARRIVALS = 40;
const MAX_EVENTS_PER_FRAME = 40;
const PREVIEW_SEED = 7;

export function createHeroPreview() {
  const stage = document.getElementById('stage');
  const canvasElement = document.getElementById('stage-canvas');
  const modelLabel = document.getElementById('stage-model');
  const toggleButton = document.getElementById('stage-toggle');
  const toggleIcon = document.getElementById('stage-toggle-icon');
  const toggleLabel = document.getElementById('stage-toggle-label');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const canvas = new QueueCanvas(canvasElement, { figures: true, figureScale: 1.3, minHeight: 230 });

  let system = null;
  let simulation = null;
  let visualClock = 0;
  let active = true;
  // If the user asked for reduced motion, the preview stays still until they press Play.
  let playing = !reducedMotion.matches;
  let frameId = null;
  let lastFrame = 0;

  function restart() {
    simulation = new QueueSimulation({ ...system, duration: ENDLESS_HOURS, seed: PREVIEW_SEED });
    visualClock = HEAD_START_ARRIVALS / system.arrivalRate;
    while (simulation.fel.peek().time <= visualClock) simulation.step();

    canvas.configure({ servers: system.servers, capacity: system.capacity });
    canvas.sync(simulation, false);
    canvas.draw(0, visualClock);
  }

  function frame(now) {
    frameId = requestAnimationFrame(frame);
    const dt = Math.min((now - lastFrame) / 1000, 0.1);
    lastFrame = now;

    visualClock += (dt * ARRIVALS_PER_SECOND) / system.arrivalRate;
    let processed = 0;
    while (simulation.fel.peek().time <= visualClock && processed < MAX_EVENTS_PER_FRAME) {
      const event = simulation.step();
      if (event.outcome === ARRIVAL_OUTCOME.REJECTED) canvas.reject(event.customer);
      processed++;
    }
    if (processed > 0) canvas.sync(simulation, true);
    canvas.draw(dt, visualClock);
  }

  /** The drawing loop only runs while the Setup layer is visible and not paused. */
  function updateLoop() {
    const shouldRun = active && playing && system !== null;
    if (shouldRun && frameId === null) {
      lastFrame = performance.now();
      frameId = requestAnimationFrame(frame);
    } else if (!shouldRun && frameId !== null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
  }

  function renderToggle() {
    stage.dataset.playing = String(playing);
    toggleIcon.setAttribute('href', playing ? '#i-pause' : '#i-play');
    toggleLabel.textContent = playing ? 'Pause' : 'Play';
  }

  toggleButton.addEventListener('click', () => {
    playing = !playing;
    renderToggle();
    updateLoop();
  });

  new ResizeObserver(() => {
    if (!simulation) return;
    canvas.resize();
    canvas.sync(simulation, false);
    canvas.draw(0, visualClock);
  }).observe(canvasElement.parentElement);

  renderToggle();

  return {
    /** Replaces the queueing system on show; the preview starts over. */
    setSystem(next) {
      system = next;
      const rho = analyze(system).trafficIntensity;
      modelLabel.textContent = `${kendallNotation(system)} · ρ ${formatNumber(rho, 3)}`;
      restart();
      updateLoop();
    },

    /** The preview stops drawing while the Setup layer is not visible. */
    setActive(isActive) {
      active = isActive;
      updateLoop();
    },
  };
}

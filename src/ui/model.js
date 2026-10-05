/**
 * Plain-language descriptions of a configuration: its model name in Kendall's
 * notation and its stability warning. Shared by the Setup layer and the
 * Results layer so the wording is the same in both places.
 */

import { DISCIPLINE } from '../sim/engine.js';
import { h, icon } from './dom.js';
import { formatNumber, formatPercent, pluralize } from './format.js';

const DISCIPLINE_LABEL = {
  [DISCIPLINE.FIFO]: 'FIFO',
  [DISCIPLINE.LIFO]: 'LIFO',
  [DISCIPLINE.PRIORITY]: 'Priority',
};

/**
 * Kendall's notation A/S/c/K: interarrival distribution / service
 * distribution / number of servers / system capacity. "M" stands for Markov,
 * that is, exponential.
 */
export function kendallNotation(config) {
  const base = `M/M/${config.servers}`;
  return config.capacity === Infinity ? base : `${base}/${config.capacity}`;
}

export function disciplineLabel(config) {
  if (config.discipline !== DISCIPLINE.PRIORITY) return DISCIPLINE_LABEL[config.discipline];
  return `Priority ${formatPercent(config.priorityShare, 0)}`;
}

export function describeCapacity(config) {
  return config.capacity === Infinity
    ? 'unlimited capacity'
    : `capacity ${pluralize(config.capacity, 'customer')}`;
}

/** Load level for the ρ gauge. */
export function loadLevel(trafficIntensity) {
  if (trafficIntensity >= 1) return 'unstable';
  return trafficIntensity >= 0.8 ? 'busy' : 'calm';
}

/**
 * Automatic warning based on ρ = λ/(cμ).
 *
 * - Unlimited queue and ρ >= 1: the system is unstable.
 * - Limited capacity and ρ >= 1: still stable, but many customers are turned away.
 *
 * @returns {{ level: 'danger' | 'info', title: string, paragraphs: string[] } | null}
 */
export function stabilityNotice(config, analytic) {
  const { arrivalRate, serviceRate, servers, capacity } = config;
  const rho = analytic.trafficIntensity;
  if (rho < 1) return null;

  const serviceCapacity = servers * serviceRate;
  const rhoText = formatNumber(rho, 3);

  if (capacity === Infinity) {
    const growth = arrivalRate - serviceCapacity;
    const neededServers = Math.floor(arrivalRate / serviceRate) + 1;
    const growthText =
      growth > 0
        ? `The queue will grow without bound, by about ${formatNumber(growth, 1)} customers per hour on average.`
        : 'Right at ρ = 1 the queue never settles: its length keeps drifting further and further.';
    return {
      level: 'danger',
      title: `Unstable system: ρ = ${rhoText} ≥ 1`,
      paragraphs: [
        `Customers arrive at ${formatNumber(arrivalRate, 1)} per hour, but all servers together ` +
          `can only handle ${formatNumber(serviceCapacity, 1)} per hour. ${growthText}`,
        'The steady-state formulas do not apply here, so the analytic column is empty. You can ' +
          'still run the simulation to watch the queue grow.',
        `To make it stable, use at least ${neededServers} servers, speed up service, or limit the system capacity.`,
      ],
    };
  }

  return {
    level: 'info',
    title: `Load exceeds what the servers can handle: λ/(cμ) = ${rhoText}`,
    paragraphs: [
      `Because capacity is limited to ${pluralize(capacity, 'customer')}, the queue cannot grow without bound ` +
        'and the system stays stable. The excess load shows up as customers being turned away: ' +
        `according to the formula, ${formatPercent(analytic.blockingProbability)} of customers cannot get in.`,
    ],
  };
}

/** Fills a banner element with a notice, or hides it. */
export function renderNotice(element, notice) {
  element.hidden = !notice;
  element.replaceChildren();
  element.classList.remove('banner--danger', 'banner--info');
  if (!notice) return;

  element.classList.add(`banner--${notice.level}`);
  element.append(
    icon(notice.level === 'danger' ? 'alert' : 'info'),
    h('div', {}, [
      h('p', { class: 'banner__title', text: notice.title }),
      ...notice.paragraphs.map((text) => h('p', { text })),
    ]),
  );
}

/**
 * Discrete-event simulation engine for M/M/c and M/M/c/K queues.
 *
 * The simulation clock does not tick in fixed steps. It jumps straight to the
 * next event in the future event list (FEL), because nothing in the system
 * changes between two events.
 *
 * Any time unit works as long as it is used consistently: if the rates are in
 * customers per hour, then duration, warmup, W, and Wq are in hours.
 *
 * This module never touches the DOM, so it runs in Node for testing and in
 * the browser for the animation.
 */

import { EventQueue } from './event-queue.js';
import { createRng, exponential, STREAM } from './rng.js';
import { DISCIPLINE, PRIORITY_CLASS, WaitingLine } from './waiting-line.js';

export { DISCIPLINE, PRIORITY_CLASS };

export const EVENT = Object.freeze({
  ARRIVAL: 'ARRIVAL',
  DEPARTURE: 'DEPARTURE',
  WARMUP_END: 'WARMUP_END',
  END: 'END',
});

/** What happens to a customer at the moment of arrival. */
export const ARRIVAL_OUTCOME = Object.freeze({
  SERVED: 'SERVED',
  QUEUED: 'QUEUED',
  REJECTED: 'REJECTED',
});

const DEFAULTS = Object.freeze({
  servers: 1,
  discipline: DISCIPLINE.FIFO,
  capacity: Infinity,
  priorityShare: 0.2,
  warmup: 0,
  seed: 1,
  replication: 0,
});

const MAX_SEED = 0xffffffff;

/**
 * @typedef {object} SimulationConfig
 * @property {number} arrivalRate    λ, arrival rate (customers per unit of time)
 * @property {number} serviceRate    μ, service rate of one server
 * @property {number} [servers]      c, number of servers
 * @property {string} [discipline]   one of the DISCIPLINE values
 * @property {number} [capacity]     K, maximum number of customers in the system
 *                                   (waiting + in service); Infinity = unlimited
 * @property {number} [priorityShare] share of customers in the priority class
 *                                   (0 to 1), used only by the PRIORITY discipline
 * @property {number} duration       run length, warm-up included
 * @property {number} [warmup]       warm-up period whose data is discarded
 * @property {number} [seed]         seed for the random number generator
 * @property {number} [replication]  replication index; selects a different random sequence
 * @property {(wait: number, customer: object) => void} [onWait]
 *   called every time an observed customer starts service, with that
 *   customer's waiting time. Used to build a histogram without storing every value.
 * @property {() => number} [sampleInterarrival] replaces the interarrival-time generator
 * @property {() => number} [sampleService]      replaces the service-time generator
 *   The last two exist for testing only: with a hand-picked sequence of times,
 *   the course of the simulation can be worked out by hand and then compared.
 */

export class QueueSimulation {
  #stats;
  #statsStart = 0;
  #warmedUp;
  #nextCustomerId = 1;
  #sampleInterarrival;
  #sampleService;
  #priorityRng;

  /** @param {SimulationConfig} config */
  constructor(config) {
    this.config = normalizeConfig(config);
    const { arrivalRate, serviceRate, servers, discipline, duration, warmup, seed, replication } =
      this.config;

    this.clock = 0;
    this.finished = false;
    /** One entry per server: the customer being served, or null when idle. */
    this.servers = new Array(servers).fill(null);
    this.busyServers = 0;
    this.line = new WaitingLine(discipline);
    this.fel = new EventQueue();

    // The first "M" in Kendall's notation M/M/c: arrivals follow a Poisson
    // process with rate λ, which is the same as exponentially distributed
    // interarrival times with mean 1/λ.
    const arrivalRng = createRng(seed, replication, STREAM.ARRIVAL);
    this.#sampleInterarrival =
      this.config.sampleInterarrival ?? (() => exponential(arrivalRng, arrivalRate));

    // The second "M": each server's service time is exponentially distributed
    // with mean 1/μ.
    const serviceRng = createRng(seed, replication, STREAM.SERVICE);
    this.#sampleService =
      this.config.sampleService ?? (() => exponential(serviceRng, serviceRate));

    this.#priorityRng = createRng(seed, replication, STREAM.PRIORITY);

    this.#resetStats();
    this.#warmedUp = warmup === 0;

    this.fel.schedule(this.#sampleInterarrival(), EVENT.ARRIVAL);
    if (warmup > 0) this.fel.schedule(warmup, EVENT.WARMUP_END);
    this.fel.schedule(duration, EVENT.END);
  }

  /** Number of customers waiting, not yet in service. */
  get queueLength() {
    return this.line.length;
  }

  /** Number of customers in the system: waiting + in service. */
  get numberInSystem() {
    return this.busyServers + this.line.length;
  }

  /**
   * Processes exactly one event and returns a record of what happened.
   * Returns null once the simulation has finished.
   */
  step() {
    if (this.finished) return null;

    const event = this.fel.pop();
    // Time-average statistics are accumulated before the state changes: over
    // the interval (clock, event.time) the state is still the one from before
    // this event.
    this.#accumulate(event.time - this.clock);
    this.clock = event.time;

    switch (event.type) {
      case EVENT.ARRIVAL:
        return this.#handleArrival();
      case EVENT.DEPARTURE:
        return this.#handleDeparture(event.data.serverIndex);
      case EVENT.WARMUP_END:
        // Only the statistics are thrown away. Customers who are waiting or
        // being served stay where they are: this "already filled" condition is
        // precisely the starting point we want to observe from.
        this.#resetStats();
        this.#warmedUp = true;
        return { type: EVENT.WARMUP_END, time: this.clock };
      default:
        this.finished = true;
        return { type: EVENT.END, time: this.clock };
    }
  }

  /** Runs the simulation to the end and returns its results. */
  run() {
    while (!this.finished) this.step();
    return this.results;
  }

  /** True once the warm-up period has passed, that is, once statistics count. */
  get warmedUp() {
    return this.#warmedUp;
  }

  /**
   * Performance measures collected from the end of the warm-up period until
   * now. Safe to read mid-run; during the warm-up they are provisional
   * figures that will be discarded.
   */
  get results() {
    const stats = this.#stats;
    const observedTime = this.clock - this.#statsStart;
    const accepted = stats.arrivals - stats.rejected;

    return {
      // ρ, utilization: the share of time a server is busy, averaged over c servers.
      rho: stats.areaBusy / (this.config.servers * observedTime),
      // L = (1/T) ∫ N(t) dt, the time average of the number in the system.
      L: stats.areaSystem / observedTime,
      // Lq = (1/T) ∫ Nq(t) dt, the time average of the number waiting.
      Lq: stats.areaQueue / observedTime,
      // W: mean time in the system (waiting + service) per customer.
      W: stats.sumSystemTime / stats.departures,
      // Wq: mean waiting time before service starts, per customer.
      Wq: stats.sumWait / stats.serviceStarts,
      // P0: the share of time the system is completely empty.
      P0: stats.timeEmpty / observedTime,

      observedTime,
      arrivals: stats.arrivals,
      rejected: stats.rejected,
      served: stats.departures,
      // Share of customers turned away. For M/M/c/K it estimates P_K, the
      // probability that the system is full.
      rejectionRate: stats.rejected / stats.arrivals,
      // Effective λ: the rate of customers who actually get in, λ(1 - P_K).
      effectiveArrivalRate: accepted / observedTime,
      // Wq per class, in PRIORITY_CLASS order: [HIGH, REGULAR].
      WqByClass: stats.sumWaitByClass.map((sum, k) => sum / stats.serviceStartsByClass[k]),
    };
  }

  #handleArrival() {
    const { capacity } = this.config;

    // Every arrival schedules the next one, so the FEL always holds exactly
    // one ARRIVAL event.
    this.fel.schedule(this.clock + this.#sampleInterarrival(), EVENT.ARRIVAL);

    const customer = {
      id: this.#nextCustomerId++,
      arrivalTime: this.clock,
      priorityClass: this.#drawPriorityClass(),
      serviceStart: null,
      serviceEnd: null,
    };
    this.#stats.arrivals++;

    const record = {
      type: EVENT.ARRIVAL,
      time: this.clock,
      customer,
      outcome: ARRIVAL_OUTCOME.QUEUED,
      serverIndex: -1,
    };

    // M/M/c/K: when K customers are already in the system, the newcomer is
    // turned away and lost (no retry).
    if (this.numberInSystem >= capacity) {
      this.#stats.rejected++;
      record.outcome = ARRIVAL_OUTCOME.REJECTED;
      return record;
    }

    const idleServer = this.servers.indexOf(null);
    if (idleServer === -1) {
      this.line.push(customer);
    } else {
      this.#startService(customer, idleServer);
      record.outcome = ARRIVAL_OUTCOME.SERVED;
      record.serverIndex = idleServer;
    }
    return record;
  }

  #handleDeparture(serverIndex) {
    const customer = this.servers[serverIndex];
    this.servers[serverIndex] = null;
    this.busyServers--;

    if (this.#isObserved(customer)) {
      this.#stats.sumSystemTime += this.clock - customer.arrivalTime;
      this.#stats.departures++;
    }

    // The server that just became free calls the next customer right away.
    // Who gets called is decided by the queue discipline.
    const next = this.line.length > 0 ? this.line.next() : null;
    if (next) this.#startService(next, serverIndex);

    return { type: EVENT.DEPARTURE, time: this.clock, customer, serverIndex, next };
  }

  #startService(customer, serverIndex) {
    customer.serviceStart = this.clock;
    customer.serviceEnd = this.clock + this.#sampleService();
    this.servers[serverIndex] = customer;
    this.busyServers++;

    if (this.#isObserved(customer)) {
      const wait = this.clock - customer.arrivalTime;
      const stats = this.#stats;
      stats.sumWait += wait;
      stats.serviceStarts++;
      stats.sumWaitByClass[customer.priorityClass] += wait;
      stats.serviceStartsByClass[customer.priorityClass]++;
      // During the warm-up the statistics will still be discarded, so the
      // value is not passed on yet.
      if (this.#warmedUp) this.config.onWait?.(wait, customer);
    }

    this.fel.schedule(customer.serviceEnd, EVENT.DEPARTURE, { serverIndex });
  }

  /**
   * Under the priority discipline, each customer joins the high class with
   * probability priorityShare. Randomly splitting a Poisson process of rate λ
   * this way yields two independent Poisson processes with rates p·λ and
   * (1 - p)·λ. That property is what makes Cobham's priority formula apply.
   */
  #drawPriorityClass() {
    const { discipline, priorityShare } = this.config;
    if (discipline !== DISCIPLINE.PRIORITY) return PRIORITY_CLASS.REGULAR;
    return this.#priorityRng() < priorityShare ? PRIORITY_CLASS.HIGH : PRIORITY_CLASS.REGULAR;
  }

  /**
   * W and Wq are computed only from customers who arrive after the warm-up.
   * Earlier customers met a system that was still empty, so their waits are
   * too short and would bias the average.
   */
  #isObserved(customer) {
    return customer.arrivalTime >= this.#statsStart;
  }

  /**
   * Adds to the area under the curve for the time-average statistics.
   *
   * Over an interval of length dt the state does not change, so the added
   * area is a rectangle: (state value) x dt. Dividing the total area by the
   * observation time gives the average over time.
   */
  #accumulate(dt) {
    const stats = this.#stats;
    const inQueue = this.line.length;
    const inSystem = this.busyServers + inQueue;
    stats.areaSystem += inSystem * dt;
    stats.areaQueue += inQueue * dt;
    stats.areaBusy += this.busyServers * dt;
    if (inSystem === 0) stats.timeEmpty += dt;
  }

  #resetStats() {
    this.#statsStart = this.clock;
    this.#stats = {
      areaSystem: 0,
      areaQueue: 0,
      areaBusy: 0,
      timeEmpty: 0,
      arrivals: 0,
      rejected: 0,
      departures: 0,
      sumSystemTime: 0,
      serviceStarts: 0,
      sumWait: 0,
      serviceStartsByClass: [0, 0],
      sumWaitByClass: [0, 0],
    };
  }
}

function normalizeConfig(input) {
  const config = { ...DEFAULTS, ...input };
  const { servers, capacity, discipline, priorityShare, duration, warmup, seed, replication } =
    config;

  requirePositive(config.arrivalRate, 'Arrival rate (λ)');
  requirePositive(config.serviceRate, 'Service rate (μ)');
  requirePositive(duration, 'Run length');

  if (!Number.isInteger(servers) || servers < 1) {
    throw new RangeError('Number of servers (c) must be an integer of at least 1.');
  }
  if (capacity !== Infinity && (!Number.isInteger(capacity) || capacity < servers)) {
    throw new RangeError(
      'System capacity (K) must be an integer no smaller than the number of servers (c).',
    );
  }
  if (!Object.values(DISCIPLINE).includes(discipline)) {
    throw new RangeError(`Unknown queue discipline: ${discipline}.`);
  }
  if (!(priorityShare >= 0 && priorityShare <= 1)) {
    throw new RangeError('Priority share must be between 0 and 1.');
  }
  if (!(warmup >= 0 && warmup < duration)) {
    throw new RangeError('Warm-up must be non-negative and shorter than the run length.');
  }
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) {
    throw new RangeError(`Seed must be an integer from 0 to ${MAX_SEED}.`);
  }
  if (!Number.isInteger(replication) || replication < 0) {
    throw new RangeError('Replication index must be a non-negative integer.');
  }
  return Object.freeze(config);
}

function requirePositive(value, label) {
  if (!(Number.isFinite(value) && value > 0)) {
    throw new RangeError(`${label} must be a positive number.`);
  }
}

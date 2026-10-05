import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ARRIVAL_OUTCOME,
  DISCIPLINE,
  EVENT,
  PRIORITY_CLASS,
  QueueSimulation,
} from '../src/sim/engine.js';

const TOLERANCE = 1e-9;

function assertClose(actual, expected, tolerance = TOLERANCE, label = '') {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label} expected ${expected}, got ${actual}`,
  );
}

/** A generator that emits a fixed sequence; once it runs out there are no more events. */
function scripted(values) {
  let index = 0;
  return () => values[index++] ?? Infinity;
}

function collectEvents(simulation) {
  const events = [];
  for (let event = simulation.step(); event; event = simulation.step()) events.push(event);
  return events;
}

function variance(values) {
  const mean = values.reduce((sum, x) => sum + x, 0) / values.length;
  return values.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (values.length - 1);
}

/**
 * A scenario that can be worked out by hand, one server:
 *
 *   A arrives at 2.1, service takes 3.2  -> leaves at 5.3
 *   B arrives at 3.0, waits until 5.3, service takes 0.7 -> leaves at 6.0
 *   C arrives at 7.4, is served at once, still in service when the run ends at 8.0
 *
 *   time      0    2.1   3.0        5.3   6.0     7.4   8.0
 *   N(t)      | 0  | 1   |    2     | 1   |   0   | 1   |
 */
// The rates are unused because the times are given directly, but they are still required.
const HAND_TRACE = { arrivalRate: 1, serviceRate: 1, servers: 1, duration: 8 };
const handTrace = (overrides = {}) =>
  new QueueSimulation({
    ...HAND_TRACE,
    sampleInterarrival: scripted([2.1, 0.9, 4.4]),
    sampleService: scripted([3.2, 0.7, 5.0]),
    ...overrides,
  });

test('the event trace matches the hand calculation', () => {
  const events = collectEvents(handTrace());

  assert.deepEqual(
    events.map((event) => event.type),
    [EVENT.ARRIVAL, EVENT.ARRIVAL, EVENT.DEPARTURE, EVENT.DEPARTURE, EVENT.ARRIVAL, EVENT.END],
  );
  [2.1, 3.0, 5.3, 6.0, 7.4, 8.0].forEach((time, i) => assertClose(events[i].time, time));

  const [arrivalA, arrivalB, departureA, departureB, arrivalC] = events;
  assert.equal(arrivalA.outcome, ARRIVAL_OUTCOME.SERVED);
  assert.equal(arrivalA.serverIndex, 0);
  assert.equal(arrivalB.outcome, ARRIVAL_OUTCOME.QUEUED);
  assert.equal(departureA.customer.id, arrivalA.customer.id);
  assertClose(arrivalA.customer.serviceEnd, 5.3, TOLERANCE, 'scheduled end of service for A');
  assertClose(arrivalB.customer.serviceStart, 5.3, TOLERANCE, 'start of service for B');
  assert.equal(departureA.next.id, arrivalB.customer.id, 'B is called when A leaves');
  assert.equal(departureB.next, null, 'the queue is empty, so the server goes idle');
  assert.equal(arrivalC.outcome, ARRIVAL_OUTCOME.SERVED);
});

test('the statistics match the hand calculation', () => {
  const results = handTrace().run();

  // Area under N(t): 1(0.9) + 2(2.3) + 1(0.7) + 1(0.6) = 6.8
  assertClose(results.L, 6.8 / 8, TOLERANCE, 'L');
  // Only B waits, for 2.3
  assertClose(results.Lq, 2.3 / 8, TOLERANCE, 'Lq');
  // The server is busy on [2.1, 6.0] and [7.4, 8.0]: 3.9 + 0.6 = 4.5
  assertClose(results.rho, 4.5 / 8, TOLERANCE, 'rho');
  // The system is empty on [0, 2.1] and [6.0, 7.4]: 2.1 + 1.4 = 3.5
  assertClose(results.P0, 3.5 / 8, TOLERANCE, 'P0');
  // A spends 3.2 in the system and B 3.0; C has not left yet, so it is not counted
  assertClose(results.W, (3.2 + 3.0) / 2, TOLERANCE, 'W');
  // Waiting times: A = 0, B = 2.3, C = 0
  assertClose(results.Wq, 2.3 / 3, TOLERANCE, 'Wq');

  assert.equal(results.arrivals, 3);
  assert.equal(results.served, 2);
  assert.equal(results.rejected, 0);
});

test('the warm-up period discards statistics but does not empty the system', () => {
  const simulation = handTrace({ warmup: 4 });
  const events = collectEvents(simulation);
  const results = simulation.results;

  assert.equal(events[2].type, EVENT.WARMUP_END);
  assertClose(results.observedTime, 4);
  // On [4, 8]: N(t) = 2 for 1.3, 1 for 0.7, 0 for 1.4, 1 for 0.6.
  // The initial 2 proves that A and B are still in the system after the warm-up.
  assertClose(results.L, (2 * 1.3 + 0.7 + 0.6) / 4, TOLERANCE, 'L');
  assertClose(results.Lq, 1.3 / 4, TOLERANCE, 'Lq');
  assertClose(results.rho, 2.6 / 4, TOLERANCE, 'rho');
  assertClose(results.P0, 1.4 / 4, TOLERANCE, 'P0');
  // A and B arrived before the warm-up ended, so only C is counted.
  assert.equal(results.arrivals, 1);
  assert.equal(results.served, 0);
  assertClose(results.Wq, 0, TOLERANCE, 'Wq');
  assert.ok(Number.isNaN(results.W), 'no observed customer has left yet');
});

test('the second server is used before anyone has to queue', () => {
  // Three customers arrive in a row, each with a long service time.
  const simulation = new QueueSimulation({
    ...HAND_TRACE,
    servers: 2,
    sampleInterarrival: scripted([1, 1, 1]),
    sampleService: scripted([10, 10, 10]),
  });
  const [first, second, third] = collectEvents(simulation);

  assert.deepEqual([first.outcome, first.serverIndex], [ARRIVAL_OUTCOME.SERVED, 0]);
  assert.deepEqual([second.outcome, second.serverIndex], [ARRIVAL_OUTCOME.SERVED, 1]);
  assert.equal(third.outcome, ARRIVAL_OUTCOME.QUEUED);
  assert.equal(simulation.queueLength, 1);
  assert.equal(simulation.numberInSystem, 3);
});

test('the same seed gives identical results, a different seed gives different results', () => {
  const config = { arrivalRate: 8, serviceRate: 10, duration: 200, warmup: 20, seed: 123 };
  const first = new QueueSimulation(config).run();

  assert.deepEqual(new QueueSimulation(config).run(), first);
  assert.notDeepEqual(new QueueSimulation({ ...config, seed: 124 }).run(), first);
  assert.notDeepEqual(new QueueSimulation({ ...config, replication: 1 }).run(), first);
});

test('M/M/c/K: the system never holds more than K, and extra customers are rejected', () => {
  const capacity = 5;
  const simulation = new QueueSimulation({
    arrivalRate: 30,
    serviceRate: 5,
    servers: 2,
    capacity,
    duration: 200,
    seed: 9,
  });

  let reachedCapacity = false;
  for (let event = simulation.step(); event; event = simulation.step()) {
    assert.ok(simulation.numberInSystem <= capacity);
    if (simulation.numberInSystem === capacity) reachedCapacity = true;
    if (event.outcome === ARRIVAL_OUTCOME.REJECTED) {
      assert.equal(simulation.numberInSystem, capacity, 'rejections only happen when full');
    }
  }
  const results = simulation.results;

  assert.ok(reachedCapacity);
  assert.ok(results.rejected > 0);
  // Every arriving customer was rejected, has left, or is still inside.
  assert.equal(results.arrivals, results.rejected + results.served + simulation.numberInSystem);
  assertClose(results.rejectionRate, results.rejected / results.arrivals);
});

test('without a capacity limit no customer is rejected', () => {
  const results = new QueueSimulation({
    arrivalRate: 30,
    serviceRate: 5,
    servers: 2,
    duration: 100,
  }).run();

  assert.equal(results.rejected, 0);
  // λ > c·μ, so the system is unstable: the queue keeps growing and the
  // servers are almost never idle.
  assert.ok(results.rho > 0.98, `rho ${results.rho}`);
  assert.ok(results.Lq > 100, `Lq ${results.Lq}`);
});

test('the queue discipline does not change the number of customers in the system', () => {
  const config = { arrivalRate: 8, serviceRate: 10, duration: 2000, warmup: 100, seed: 77 };
  const run = (discipline) => new QueueSimulation({ ...config, discipline }).run();
  const fifo = run(DISCIPLINE.FIFO);
  const lifo = run(DISCIPLINE.LIFO);
  const priority = run(DISCIPLINE.PRIORITY);

  // With the same random sequences, when a service starts and ends does not
  // depend on who is called. So N(t) is exactly the same.
  for (const metric of ['rho', 'L', 'Lq', 'P0']) {
    assert.equal(lifo[metric], fifo[metric], metric);
    assert.equal(priority[metric], fifo[metric], metric);
  }
  // The mean waiting time differs only by the handful of customers still
  // queueing when the run ends.
  assertClose(lifo.Wq / fifo.Wq, 1, 0.01, 'Wq of LIFO relative to FIFO');
  assertClose(priority.Wq / fifo.Wq, 1, 0.01, 'Wq of priority relative to FIFO');
});

test('LIFO makes waiting times far more variable than FIFO', () => {
  const config = { arrivalRate: 8, serviceRate: 10, duration: 2000, warmup: 100, seed: 77 };
  const waitsUnder = (discipline) => {
    const waits = [];
    const results = new QueueSimulation({
      ...config,
      discipline,
      onWait: (wait) => waits.push(wait),
    }).run();
    return { waits, results };
  };
  const fifo = waitsUnder(DISCIPLINE.FIFO);
  const lifo = waitsUnder(DISCIPLINE.LIFO);

  // onWait is called exactly once per observed customer who starts service,
  // so its mean must equal the Wq the engine reports.
  assert.ok(fifo.waits.length > 0 && fifo.waits.length <= fifo.results.arrivals);
  assert.ok(fifo.waits.every((wait) => wait >= 0));
  const meanWait = fifo.waits.reduce((sum, wait) => sum + wait, 0) / fifo.waits.length;
  assertClose(meanWait, fifo.results.Wq, 1e-9, 'mean of onWait');
  // M/M/1 theory at ρ = 0.8: the variance of Wq under LIFO is about 7.7 times that of FIFO.
  assert.ok(variance(lifo.waits) > 3 * variance(fifo.waits));
});

test('priority customers wait less than regular customers', () => {
  const priorityShare = 0.2;
  const results = new QueueSimulation({
    arrivalRate: 8,
    serviceRate: 10,
    discipline: DISCIPLINE.PRIORITY,
    priorityShare,
    duration: 5000,
    warmup: 200,
    seed: 31,
  }).run();
  const high = results.WqByClass[PRIORITY_CLASS.HIGH];
  const regular = results.WqByClass[PRIORITY_CLASS.REGULAR];

  assert.ok(high < regular / 2, `priority ${high}, regular ${regular}`);
  // The weighted average of the two classes comes back to the overall Wq.
  assertClose((priorityShare * high + (1 - priorityShare) * regular) / results.Wq, 1, 0.03);
});

test("Little's law holds in the simulation results: L = λ·W and Lq = λ·Wq", () => {
  const results = new QueueSimulation({
    arrivalRate: 20,
    serviceRate: 8,
    servers: 3,
    duration: 5000,
    warmup: 200,
    seed: 2,
  }).run();
  const lambda = results.effectiveArrivalRate;

  assertClose(results.L / (lambda * results.W), 1, 0.01, 'L relative to λW');
  assertClose(results.Lq / (lambda * results.Wq), 1, 0.01, 'Lq relative to λWq');
});

test("Little's law still holds for M/M/c/K when the effective λ is used", () => {
  const results = new QueueSimulation({
    arrivalRate: 20,
    serviceRate: 8,
    servers: 2,
    capacity: 6,
    duration: 5000,
    warmup: 200,
    seed: 2,
  }).run();
  const lambda = results.effectiveArrivalRate;

  assert.ok(results.rejected > 0);
  assertClose(results.L / (lambda * results.W), 1, 0.01, 'L relative to λ_eff W');
  // Utilization = λ_eff / (c·μ). Unlike Little's law, this equality holds only
  // on average: the left side uses the service times actually drawn, the
  // right side uses 1/μ. The mean of about 71 thousand service times deviates
  // from 1/μ by roughly 1/√71000 = 0.4%, hence the 2% tolerance.
  assertClose(results.rho / (lambda / (2 * 8)), 1, 0.02, 'rho relative to λ_eff/(cμ)');
});

test('a finished simulation processes no more events', () => {
  const simulation = new QueueSimulation({ arrivalRate: 5, serviceRate: 10, duration: 10 });
  const results = simulation.run();

  assert.equal(simulation.finished, true);
  assert.equal(simulation.clock, 10);
  assert.equal(simulation.step(), null);
  assert.deepEqual(simulation.results, results);
});

test('an invalid configuration is rejected', () => {
  const valid = { arrivalRate: 8, serviceRate: 10, duration: 100 };
  const invalid = [
    { arrivalRate: 0 },
    { arrivalRate: -1 },
    { serviceRate: Number.NaN },
    { servers: 0 },
    { servers: 1.5 },
    { servers: 3, capacity: 2 },
    { capacity: 2.5 },
    { discipline: 'RANDOM' },
    { priorityShare: 1.2 },
    { duration: 0 },
    { warmup: 100 },
    { warmup: -1 },
    { seed: 1.5 },
    { seed: -1 },
    { replication: -1 },
  ];

  assert.doesNotThrow(() => new QueueSimulation(valid));
  for (const override of invalid) {
    assert.throws(
      () => new QueueSimulation({ ...valid, ...override }),
      RangeError,
      JSON.stringify(override),
    );
  }
});

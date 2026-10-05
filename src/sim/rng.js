/**
 * Seeded random number generator.
 *
 * Math.random() cannot be seeded, so a simulation built on it can never be
 * repeated. This module uses sfc32 (Small Fast Counter, 32-bit, by Chris
 * Doty-Humphrey): the same seed always produces the same sequence.
 */

/**
 * Random stream numbers. Each source of randomness gets its own stream, so
 * changing the queue discipline or the number of servers does not shift the
 * sequence of interarrival times. This technique is called common random
 * numbers: two scenarios are compared on exactly the same arrival pattern.
 */
export const STREAM = Object.freeze({
  ARRIVAL: 1,
  SERVICE: 2,
  PRIORITY: 3,
});

// Initial rounds that are thrown away so the starting state gets mixed first
// (as PractRand recommends).
const SEEDING_ROUNDS = 15;

/**
 * Creates a generator of uniform random numbers on [0, 1).
 *
 * The initial state is (seed, replication, stream). Because the sfc32 step is
 * reversible, three different numbers always lead to different trajectories,
 * so every replication and every stream gets its own sequence.
 *
 * @param {number} seed        integer from 0 to 2^32 - 1
 * @param {number} replication replication index (0, 1, 2, ...)
 * @param {number} stream      one of the STREAM values
 * @returns {() => number}
 */
export function createRng(seed, replication = 0, stream = 0) {
  let a = seed | 0;
  let b = replication | 0;
  let c = stream | 0;
  let counter = 1;

  function next() {
    const t = (((a + b) | 0) + counter) | 0;
    counter = (counter + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  for (let i = 0; i < SEEDING_ROUNDS; i++) next();
  return next;
}

/**
 * Exponential variate by the inverse transform method.
 *
 * The CDF of the exponential distribution is F(x) = 1 - e^(-rate * x).
 * Set F(x) equal to a uniform number U and solve for x:
 *
 *   x = -ln(1 - U) / rate
 *
 * Its mean is 1/rate. U lies in [0, 1), so 1 - U is never zero and the
 * logarithm is always defined.
 */
export function exponential(rng, rate) {
  return -Math.log(1 - rng()) / rate;
}

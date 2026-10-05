/**
 * A waiting-time histogram that adjusts its own range.
 *
 * The range of waiting times is unknown before the simulation runs: in a
 * lightly loaded system almost everyone waits a few minutes, in an unstable
 * one it can be hours. So values are counted into fine bins of width
 * `resolution`, and the bars to display are only formed on request, by
 * merging as many fine bins as needed.
 *
 * Customers who do not wait at all are counted separately. In a queue that is
 * not overcrowded they are the majority, and theory treats them as a
 * probability mass of their own at zero, not as part of the curve.
 */

/** Maximum number of fine bins; larger values go into the last bin. */
const MAX_FINE_BINS = 500_000;

/** The smallest of 1, 2, 5, 10, 20, 50, ... that is not less than `value`. */
export function niceCeil(value) {
  if (!(value > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) {
    if (step * magnitude >= value * (1 - 1e-12)) return step * magnitude;
  }
  return 10 * magnitude;
}

/** The largest of 1, 2, 5, 10, ... that is not more than `value`. */
export function niceFloor(value) {
  if (!(value > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [10, 5, 2]) {
    if (step * magnitude <= value * (1 + 1e-12)) return step * magnitude;
  }
  return magnitude;
}

export class WaitHistogram {
  #resolution;
  #counts = [];
  #zeros = 0;
  #total = 0;
  #sum = 0;

  /** @param {number} resolution width of a fine bin, in the same unit as the values added */
  constructor(resolution) {
    this.#resolution = resolution;
  }

  get total() {
    return this.#total;
  }

  get mean() {
    return this.#sum / this.#total;
  }

  add(wait) {
    this.#total++;
    this.#sum += wait;
    if (wait <= 0) {
      this.#zeros++;
      return;
    }
    const index = Math.min(Math.floor(wait / this.#resolution), MAX_FINE_BINS - 1);
    while (this.#counts.length <= index) this.#counts.push(0);
    this.#counts[index]++;
  }

  /**
   * Builds the bars to display.
   *
   * The bar width is the smallest "round" multiple (1, 2, 5, 10, ... times
   * the resolution) such that a share `coverage` of the customers who waited
   * fits into at most `maxBars` bars. The rest, a long thin tail, becomes a
   * single "more than" bar.
   *
   * `share` is a share of ALL customers, including those who did not wait.
   *
   * @returns {{
   *   width: number,
   *   zeroShare: number,
   *   bars: { from: number, to: number, share: number }[],
   *   overflow: { from: number, share: number },
   * }}
   */
  bars(maxBars = 20, coverage = 0.99) {
    const total = this.#total;
    const waited = total - this.#zeros;

    // The last fine bin still needed to reach `coverage`.
    let needed = 1;
    let running = 0;
    for (let i = 0; i < this.#counts.length && running < coverage * waited; i++) {
      running += this.#counts[i];
      needed = i + 1;
    }

    // Fine bins per bar; at least one, because a fine bin cannot be split.
    const factor = niceCeil(Math.max(1, needed / maxBars));
    const barCount = Math.min(maxBars, Math.max(1, Math.ceil(needed / factor)));
    const width = factor * this.#resolution;

    const bars = [];
    let shown = 0;
    for (let b = 0; b < barCount; b++) {
      let count = 0;
      for (let i = b * factor; i < (b + 1) * factor && i < this.#counts.length; i++) {
        count += this.#counts[i];
      }
      shown += count;
      bars.push({ from: b * width, to: (b + 1) * width, share: total ? count / total : 0 });
    }

    return {
      width,
      zeroShare: total ? this.#zeros / total : 0,
      bars,
      overflow: { from: barCount * width, share: total ? (waited - shown) / total : 0 },
    };
  }
}

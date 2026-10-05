/**
 * Condenses a step signal into few enough points to draw.
 *
 * Queue length is a step signal: its value stays constant between two events.
 * A long simulation produces millions of steps, far too many for one chart.
 * This class divides the time axis into equal-width bins and stores the area
 * under the curve per bin, so each bin can be drawn as a single point whose
 * value is the time average.
 *
 * When the number of bins exceeds the limit, neighboring bins are merged in
 * pairs and the bin width doubles. Because areas are stored, not averages,
 * merging loses no precision: the total area stays the same.
 */
export class BinnedSeries {
  #binWidth;
  #maxBins;
  #averageFrom;
  #areas = [];
  /** Cumulative area since `averageFrom`, recorded at the end of each bin. */
  #cumulative = [];
  #cumulativeTotal = 0;
  #end = 0;

  /**
   * @param {object} options
   * @param {number} options.binWidth      initial bin width
   * @param {number} [options.maxBins]     maximum number of bins before merging
   * @param {number} [options.averageFrom] time at which the running average
   *                                       starts (the end of the warm-up)
   */
  constructor({ binWidth, maxBins = 400, averageFrom = 0 }) {
    this.#binWidth = binWidth;
    this.#maxBins = maxBins;
    this.#averageFrom = averageFrom;
  }

  get binWidth() {
    return this.#binWidth;
  }

  /** Records that the signal equals `value` over the time interval [from, to). */
  add(from, to, value) {
    if (!(to > from)) return;
    while (to > this.#binWidth * this.#maxBins) this.#mergePairs();

    let index = Math.floor(from / this.#binWidth);
    let start = from;
    while (start < to) {
      const stop = Math.min(to, (index + 1) * this.#binWidth);
      if (stop > start) {
        while (this.#areas.length <= index) {
          this.#areas.push(0);
          this.#cumulative.push(this.#cumulativeTotal);
        }
        this.#areas[index] += value * (stop - start);
        const observed = stop - Math.max(start, this.#averageFrom);
        if (observed > 0) this.#cumulativeTotal += value * observed;
        this.#cumulative[index] = this.#cumulativeTotal;
        start = stop;
      }
      index++;
    }
    this.#end = to;
  }

  /**
   * One point per bin.
   *
   * - `mean`: the time average of the signal within that bin.
   * - `runningMean`: the time average from `averageFrom` to the end of the
   *   bin, an estimate that gets closer and closer to the steady-state value.
   *   It is null during the warm-up period.
   *
   * @returns {{ from: number, to: number, mean: number, runningMean: number | null }[]}
   */
  points() {
    const points = [];
    for (let i = 0; i < this.#areas.length; i++) {
      const from = i * this.#binWidth;
      const to = Math.min(from + this.#binWidth, this.#end);
      if (!(to > from)) continue;
      const observed = to - this.#averageFrom;
      points.push({
        from,
        to,
        mean: this.#areas[i] / (to - from),
        runningMean: observed > 0 ? this.#cumulative[i] / observed : null,
      });
    }
    return points;
  }

  #mergePairs() {
    const areas = [];
    const cumulative = [];
    for (let i = 0; i < this.#areas.length; i += 2) {
      areas.push(this.#areas[i] + (this.#areas[i + 1] ?? 0));
      cumulative.push(this.#cumulative[i + 1] ?? this.#cumulative[i]);
    }
    this.#areas = areas;
    this.#cumulative = cumulative;
    this.#binWidth *= 2;
  }
}

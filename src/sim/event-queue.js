/**
 * Future event list (FEL): the events that have been scheduled but have not
 * happened yet. The simulation engine always takes the earliest one.
 *
 * Stored as a binary min-heap inside an array: the children of index i sit at
 * 2i + 1 and 2i + 2, and a parent is always earlier than its children, so the
 * earliest event is always at index 0. Insert and remove are both O(log n).
 */
export class EventQueue {
  #heap = [];
  #nextSeq = 0;

  get size() {
    return this.#heap.length;
  }

  /**
   * Schedules a new event.
   *
   * `seq` is the scheduling order. When two events fall at the same time, the
   * one scheduled first is processed first. Without it the order would depend
   * on the shape of the heap, and results could differ from run to run.
   */
  schedule(time, type, data = null) {
    const event = { time, seq: this.#nextSeq++, type, data };
    this.#heap.push(event);
    this.#siftUp(this.#heap.length - 1);
    return event;
  }

  /** The earliest event, without removing it. */
  peek() {
    return this.#heap[0];
  }

  /** Removes and returns the earliest event, or undefined when empty. */
  pop() {
    const heap = this.#heap;
    if (heap.length === 0) return undefined;

    const earliest = heap[0];
    const last = heap.pop();
    if (heap.length > 0) {
      heap[0] = last;
      this.#siftDown(0);
    }
    return earliest;
  }

  #siftUp(index) {
    const heap = this.#heap;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!isEarlier(heap[index], heap[parent])) break;
      [heap[index], heap[parent]] = [heap[parent], heap[index]];
      index = parent;
    }
  }

  #siftDown(index) {
    const heap = this.#heap;
    const length = heap.length;
    for (;;) {
      const left = 2 * index + 1;
      const right = left + 1;
      let earliest = index;
      if (left < length && isEarlier(heap[left], heap[earliest])) earliest = left;
      if (right < length && isEarlier(heap[right], heap[earliest])) earliest = right;
      if (earliest === index) break;
      [heap[index], heap[earliest]] = [heap[earliest], heap[index]];
      index = earliest;
    }
  }
}

function isEarlier(a, b) {
  return a.time < b.time || (a.time === b.time && a.seq < b.seq);
}

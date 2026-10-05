/**
 * The waiting line: customers who have arrived but are not being served yet.
 *
 * The queue discipline decides exactly one thing: which customer is called
 * when a server becomes free. Every difference between FIFO, LIFO, and
 * priority is contained in this file.
 */

export const DISCIPLINE = Object.freeze({
  FIFO: 'FIFO',
  LIFO: 'LIFO',
  PRIORITY: 'PRIORITY',
});

/** The two customer classes. The smaller number is served first. */
export const PRIORITY_CLASS = Object.freeze({
  HIGH: 0,
  REGULAR: 1,
});

/**
 * A FIFO queue with a head pointer. Array.prototype.shift() moves every
 * element on each call, which gets slow once the queue grows long in an
 * unstable system.
 */
class FifoQueue {
  #items = [];
  #head = 0;

  get length() {
    return this.#items.length - this.#head;
  }

  push(item) {
    this.#items.push(item);
  }

  shift() {
    if (this.length === 0) return undefined;
    const item = this.#items[this.#head];
    this.#items[this.#head++] = undefined;
    // Drop the emptied front part once it makes up more than half the array.
    if (this.#head > 1024 && this.#head * 2 > this.#items.length) {
      this.#items = this.#items.slice(this.#head);
      this.#head = 0;
    }
    return item;
  }

  /** At most `limit` items from the front, without removing them. */
  peek(limit) {
    return this.#items.slice(this.#head, this.#head + limit);
  }
}

export class WaitingLine {
  #discipline;
  #stack = [];
  #lanes = [new FifoQueue(), new FifoQueue()];

  constructor(discipline) {
    this.#discipline = discipline;
  }

  get length() {
    return this.#stack.length + this.#lanes[0].length + this.#lanes[1].length;
  }

  push(customer) {
    switch (this.#discipline) {
      case DISCIPLINE.LIFO:
        this.#stack.push(customer);
        break;
      case DISCIPLINE.PRIORITY:
        this.#lanes[customer.priorityClass].push(customer);
        break;
      default:
        this.#lanes[0].push(customer);
    }
  }

  /**
   * Removes and returns the customer to serve next.
   *
   * - FIFO: the one who arrived earliest.
   * - LIFO: the one who arrived latest.
   * - Priority (non-preemptive): the high class always goes first, and within
   *   a class the order is FIFO. A customer already in service is never
   *   interrupted.
   */
  next() {
    if (this.#discipline === DISCIPLINE.LIFO) return this.#stack.pop();
    const [first, second] = this.#lanes;
    return first.length > 0 ? first.shift() : second.shift();
  }

  /**
   * At most `limit` customers from the front, in the order they will be
   * called, without removing them. Used by the animation to draw the line.
   */
  peek(limit) {
    if (this.#discipline === DISCIPLINE.LIFO) return this.#stack.slice(-limit).reverse();
    const [first, second] = this.#lanes;
    const head = first.peek(limit);
    return head.length < limit ? head.concat(second.peek(limit - head.length)) : head;
  }
}

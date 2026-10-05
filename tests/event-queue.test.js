import assert from 'node:assert/strict';
import test from 'node:test';

import { EventQueue } from '../src/sim/event-queue.js';
import { createRng } from '../src/sim/rng.js';

test('events come out in order, earliest first', () => {
  const fel = new EventQueue();
  for (const time of [5, 1, 4, 2, 3]) fel.schedule(time, 'X');

  const order = [];
  while (fel.size > 0) order.push(fel.pop().time);

  assert.deepEqual(order, [1, 2, 3, 4, 5]);
});

test('events at the same time are processed in scheduling order', () => {
  const fel = new EventQueue();
  fel.schedule(2, 'first');
  fel.schedule(1, 'earliest');
  fel.schedule(2, 'second');
  fel.schedule(2, 'third');

  const order = [];
  while (fel.size > 0) order.push(fel.pop().type);

  assert.deepEqual(order, ['earliest', 'first', 'second', 'third']);
});

test('order stays correct when inserts and removals are interleaved', () => {
  const rng = createRng(7);
  const fel = new EventQueue();
  const popped = [];
  let scheduled = 0;

  // Mimics how the simulation engine uses it: take one event, then schedule a
  // few new ones that are no earlier than the event just taken.
  for (let i = 0; i < 50; i++) fel.schedule(rng() * 10, 'X');
  scheduled += 50;
  while (fel.size > 0) {
    const event = fel.pop();
    popped.push(event.time);
    if (scheduled < 2000) {
      fel.schedule(event.time + rng() * 10, 'X');
      fel.schedule(event.time + rng() * 10, 'X');
      scheduled += 2;
    }
  }

  assert.equal(popped.length, scheduled);
  for (let i = 1; i < popped.length; i++) {
    assert.ok(popped[i] >= popped[i - 1], `event ${i} came out earlier than the one before it`);
  }
});

test('peek does not remove the event, and data is kept', () => {
  const fel = new EventQueue();
  fel.schedule(3, 'DEPARTURE', { serverIndex: 2 });
  fel.schedule(1, 'ARRIVAL');

  assert.equal(fel.peek().type, 'ARRIVAL');
  assert.equal(fel.size, 2);
  assert.equal(fel.pop().type, 'ARRIVAL');
  assert.deepEqual(fel.pop().data, { serverIndex: 2 });
});

test('an empty queue returns undefined', () => {
  const fel = new EventQueue();
  assert.equal(fel.pop(), undefined);
  assert.equal(fel.peek(), undefined);
  assert.equal(fel.size, 0);
});

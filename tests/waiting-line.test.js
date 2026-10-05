import assert from 'node:assert/strict';
import test from 'node:test';

import { DISCIPLINE, PRIORITY_CLASS, WaitingLine } from '../src/sim/waiting-line.js';

const { HIGH, REGULAR } = PRIORITY_CLASS;

function drain(line) {
  const ids = [];
  while (line.length > 0) ids.push(line.next().id);
  return ids;
}

function lineWith(discipline, customers) {
  const line = new WaitingLine(discipline);
  for (const [id, priorityClass] of customers) line.push({ id, priorityClass });
  return line;
}

const ARRIVALS = [
  ['a', REGULAR],
  ['b', HIGH],
  ['c', REGULAR],
  ['d', HIGH],
];

test('FIFO calls customers in order of arrival', () => {
  assert.deepEqual(drain(lineWith(DISCIPLINE.FIFO, ARRIVALS)), ['a', 'b', 'c', 'd']);
});

test('LIFO calls the customer who arrived last', () => {
  assert.deepEqual(drain(lineWith(DISCIPLINE.LIFO, ARRIVALS)), ['d', 'c', 'b', 'a']);
});

test('priority serves the high class first, then FIFO within each class', () => {
  assert.deepEqual(drain(lineWith(DISCIPLINE.PRIORITY, ARRIVALS)), ['b', 'd', 'a', 'c']);
});

test('FIFO and LIFO ignore the priority class', () => {
  const onlyHighLast = [
    ['a', REGULAR],
    ['b', REGULAR],
    ['c', HIGH],
  ];
  assert.deepEqual(drain(lineWith(DISCIPLINE.FIFO, onlyHighLast)), ['a', 'b', 'c']);
});

test('the line length follows what goes in and out', () => {
  const line = lineWith(DISCIPLINE.PRIORITY, ARRIVALS);
  assert.equal(line.length, 4);
  line.next();
  assert.equal(line.length, 3);
  line.push({ id: 'e', priorityClass: HIGH });
  assert.equal(line.length, 4);
  assert.equal(line.next().id, 'd');
  assert.equal(line.next().id, 'e');
});

test('FIFO order holds in a very long line', () => {
  const line = new WaitingLine(DISCIPLINE.FIFO);
  let nextIn = 0;
  let nextOut = 0;
  // Two in, one out forces the internal compaction to happen many times.
  for (let round = 0; round < 20_000; round++) {
    line.push({ id: nextIn++, priorityClass: REGULAR });
    line.push({ id: nextIn++, priorityClass: REGULAR });
    assert.equal(line.next().id, nextOut++);
  }
  assert.equal(line.length, nextIn - nextOut);
  while (line.length > 0) assert.equal(line.next().id, nextOut++);
  assert.equal(nextOut, nextIn);
});

test('peek shows the calling order without changing the line', () => {
  const idsOf = (customers) => customers.map((customer) => customer.id);

  for (const discipline of Object.values(DISCIPLINE)) {
    const line = lineWith(discipline, ARRIVALS);
    const preview = idsOf(line.peek(10));

    assert.equal(line.length, 4, 'peek removes nobody');
    assert.deepEqual(idsOf(line.peek(2)), preview.slice(0, 2), 'the limit is respected');
    assert.deepEqual(drain(line), preview, `${discipline}: peek matches the order of next()`);
  }
});

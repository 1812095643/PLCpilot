import test from 'node:test';
import assert from 'node:assert/strict';
import { createRetryEvents } from './retry-events.mjs';

test('five retry attempts update their own rows and a second outage creates new IDs', () => {
  const events = [];
  const emit = createRetryEvents(event => events.push(event));
  for (let attempt = 1; attempt <= 5; attempt++) emit({ attempt, maxAttempts: 5, title: `retry ${attempt}`, detail: 'HTTP 503' });
  const starts = events.filter(event => event.status === 'running');
  assert.equal(new Set(starts.map(event => event.id)).size, 5);
  assert.equal(events.filter(event => event.status === 'done').length, 4);
  emit({ attempt: 5, maxAttempts: 5, status: 'done', title: 'connected' });
  assert.equal(events.at(-1).id, starts[4].id);
  emit({ attempt: 1, maxAttempts: 5, title: 'new outage' });
  assert.notEqual(events.at(-1).id, starts[0].id);
  const last = events.at(-1).id;
  emit({ attempt: 1, maxAttempts: 5, status: 'error', title: 'cancelled' });
  assert.equal(events.at(-1).id, last);
});

test('exhaustion updates the fifth attempt instead of appending a row after the answer', () => {
  const events = [];
  const emit = createRetryEvents(event => events.push(event));
  emit({ attempt: 5, maxAttempts: 5, statusCode: 429, delayMs: 3000, title: 'retry' });
  emit({ attempt: 5, maxAttempts: 5, status: 'error', statusCode: 429, title: 'exhausted' });
  assert.equal(events[0].id, events[1].id);
  assert.equal(events[0].retry_delay_ms, 3000);
  assert.equal(events[1].retry_status, 429);
  assert.equal(events[1].status, 'error');
});

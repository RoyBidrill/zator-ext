import assert from 'node:assert/strict';
import test from 'node:test';
import { contentLengthFromHeaders, parseContentLength, summarizeRequests } from '../src/core/timing.js';

test('an empty log has no timing and no speed', () => {
  assert.deepEqual(summarizeRequests([]), { timing: null, speed: null });
});

test('one finished request is its own min, avg and tail', () => {
  const summary = summarizeRequests([{ startedAt: 0, endedAt: 300 }]);
  assert.deepEqual(summary.timing, { count: 1, min: 300, avg: 300, p99: 300 });
  assert.equal(summary.speed, null);
});

test('two requests put the slower one in the tail', () => {
  const summary = summarizeRequests([
    { startedAt: 0, endedAt: 100 },
    { startedAt: 0, endedAt: 400 },
  ]);
  assert.equal(summary.timing.min, 100);
  assert.equal(summary.timing.p99, 400);
});

test('a hundred durations use rank 99, not the maximum', () => {
  const requests = [];
  for (let ms = 1; ms <= 100; ms += 1) requests.push({ startedAt: 0, endedAt: ms });
  const summary = summarizeRequests(requests);
  assert.equal(summary.timing.count, 100);
  assert.equal(summary.timing.min, 1);
  assert.equal(summary.timing.avg, 51);
  assert.equal(summary.timing.p99, 99);
});

test('a missing length does not invent a speed', () => {
  const summary = summarizeRequests([
    { startedAt: 0, endedAt: 1000, error: 'net::ERR_TIMED_OUT' },
    { startedAt: 0, endedAt: 500 },
  ]);
  assert.equal(summary.timing.count, 2);
  assert.equal(summary.speed, null);
});

test('an unfinished request is left out of both rows', () => {
  const summary = summarizeRequests([{ startedAt: 10 }, { startedAt: 0, endedAt: 40 }]);
  assert.equal(summary.timing.count, 1);
  assert.equal(summary.timing.min, 40);
});

test('zero, junk and negative lengths stay out of speed', () => {
  const summary = summarizeRequests([
    { startedAt: 0, endedAt: 1000, contentLength: 0 },
    { startedAt: 0, endedAt: 1000, contentLength: -5 },
    { startedAt: 0, endedAt: 1000, contentLength: 1.5 },
  ]);
  assert.equal(summary.timing.count, 3);
  assert.equal(summary.speed, null);
});

test('a zero duration counts as time and not as speed', () => {
  const summary = summarizeRequests([{ startedAt: 5, endedAt: 5, contentLength: 1000 }]);
  assert.equal(summary.timing.min, 0);
  assert.equal(summary.speed, null);
});

test('speed tail is the slowest byte rate, min is the fastest', () => {
  const summary = summarizeRequests([
    { startedAt: 0, endedAt: 1000, contentLength: 1000 },
    { startedAt: 0, endedAt: 1000, contentLength: 8000 },
  ]);
  assert.equal(summary.speed.count, 2);
  assert.equal(summary.speed.min, 8000);
  assert.equal(summary.speed.p99, 1000);
  assert.equal(summary.speed.medianBytes, 4500);
});

test('the first valid Content-Length wins and is not summed', () => {
  const bytes = contentLengthFromHeaders([
    { name: 'Content-Length', value: 'nope' },
    { name: 'content-length', value: ' 12 ' },
    { name: 'Content-Length', value: '99' },
  ]);
  assert.equal(bytes, 12);
  assert.equal(parseContentLength('123abc'), null);
  assert.equal(parseContentLength(''), null);
  assert.equal(parseContentLength('0'), null);
});
